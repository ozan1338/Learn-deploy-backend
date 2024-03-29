const { user, transaction, product, profile } = require("../../models");

// Import midtransClient here ...
const midtransClient = require("midtrans-client")

const nodemailer = require("nodemailer")
const convertRupiah = require('rupiah-format')

exports.getTransactions = async (req, res) => {
  try {
    const idBuyer = req.user.id;
    let data = await transaction.findAll({
      where: {
        idBuyer,
      },
      order: [["createdAt", "DESC"]],
      attributes: {
        exclude: ["updatedAt", "idBuyer", "idSeller", "idProduct"],
      },
      include: [
        {
          model: product,
          as: "product",
          attributes: {
            exclude: [
              "createdAt",
              "updatedAt",
              "idUser",
              "qty",
              "price",
              "desc",
            ],
          },
        },
        {
          model: user,
          as: "buyer",
          attributes: {
            exclude: ["createdAt", "updatedAt", "password", "status"],
          },
        },
        {
          model: user,
          as: "seller",
          attributes: {
            exclude: ["createdAt", "updatedAt", "password", "status"],
          },
        },
      ],
    });

    data = JSON.parse(JSON.stringify(data));

    data = data.map((item) => {
      return {
        ...item,
        product: {
          ...item.product,
          image: process.env.PATH_FILE + item.product.image,
        },
      };
    });

    res.send({
      status: "success",
      data,
    });
  } catch (error) {
    console.log(error);
    res.send({
      status: "failed",
      message: "Server Error",
    });
  }
};

exports.addTransaction = async (req, res) => {
  try {
    // Prepare transaction data from body here ...
    let data = req.body
    data={
      id: parseInt(data.idProduct + Math.random().toString().slice(3, 8)),
      ...data,
      idBuyer: req.user.id,
      status: "pending"
    }

    // Insert transaction data here ...
    const newData = await transaction.create(data)

    // Get buyer data here ...
    const buyerData = await user.findOne({
      include: {
        model: profile,
        as: "profile",
        attributes: {
          exclude: ["createdAt","updatedAt","idUser"]
        }
      },
      where: {
        id: newData.idBuyer,
      },
      attributes: {
        exclude: ["createdAt","updatedAt","password"]
      }
    })

    // Create Snap API instance here ...
    let snap = new midtransClient.Snap({
      // Set to true if you want production Environment
      isProduction: false,
      serverKey: process.env.MIDTRANS_SERVER_KEY
    })

    // Create parameter for Snap API here ...
    let parameter = {
      transaction_details: {
        order_id: newData.id,
        gross_amount: newData.price,
      },
      credit_card: {
        secure: true
      },
      customer_details: {
        full_name: buyerData?.name,
        email: buyerData?.email,
        phone: buyerData?.phone
      }
    }

    // Create trasaction token & redirect_url with snap variable here ...
    const payment = await snap.createTransaction(parameter)

    res.send({
      status: "pending",
      message: "Pending transaction payment gateway",
      payment,
      product: {
        id: data.idProduct,
      },
    });
  } catch (error) {
    console.log(error);
    res.send({
      status: "failed",
      message: "Server Error",
    });
  }
};

// Create configurate midtrans client with CoreApi here ...
const MIDTRANS_SERVER_KEY = process.env.MIDTRANS_SERVER_KEY;
const MIDTRANS_CLIENT_KEY = process.env.MIDTRANS_CLIENT_KEY;

const core = new midtransClient.CoreApi();

core.apiConfig.set({
  isProduction: false,
  serverKey: MIDTRANS_SERVER_KEY,
  clientKey: MIDTRANS_CLIENT_KEY
})

/**
 *  Handle update transaction status after notification
 * from midtrans webhook
 * @param {string} status
 * @param {transactionId} transactionId
 */

// Create function for handle https notification / WebHooks of payment status here ...
exports.notification = async (req, res) => {
  try {
    const statusResponse = await core.transaction.notification(req.body);
    const orderId = statusResponse.order_id;
    const transactionStatus = statusResponse.transaction_status;
    const fraudStatus = statusResponse.fraud_status;

    console.log(statusResponse);

    
  if (transactionStatus == "capture") {
    if (fraudStatus == "challenge") {
      // TODO set transaction status on your database to 'challenge'
      // and response with 200 OK
      sendEmail("pending", orderId); //sendEmail with status pending and order id
      updateTransaction("pending", orderId);
      res.status(200);
    } else if (fraudStatus == "accept") {
      // TODO set transaction status on your database to 'success'
      // and response with 200 OK
      sendEmail("success", orderId); //sendEmail with status success and order id
      updateProduct(orderId);
      updateTransaction("success", orderId);
      res.status(200);
    }
  } else if (transactionStatus == "settlement") {
    // TODO set transaction status on your database to 'success'
    // and response with 200 OK
    sendEmail("success", orderId); //sendEmail with status success and order id
    updateProduct(orderId);
    updateTransaction("success", orderId);
    res.status(200);
  } else if (
    transactionStatus == "cancel" ||
    transactionStatus == "deny" ||
    transactionStatus == "expire"
  ) {
    // TODO set transaction status on your database to 'failure'
    // and response with 200 OK
    sendEmail("failed", orderId); //sendEmail with status failed and order id
    updateTransaction("failed", orderId);
    res.status(200);
  } else if (transactionStatus == "pending") {
    // TODO set transaction status on your database to 'pending' / waiting payment
    // and response with 200 OK
    sendEmail("pending", orderId); //sendEmail with status pending and order id
    updateTransaction("pending", orderId);
    res.status(200);
  }

  } catch (error) {
    console.log(error);
    res.status(500);
  }
};

// Create function for handle transaction update status here ...
const updateTransaction = async(status, transactionId) => {
  await transaction.update({
      status
    },
    {
      where: {
        id: transactionId
      }
    }
  )
}

// Create function for handle product update stock/qty here ...
const updateProduct = async(orderId) => {
  const transactionData = await transaction.findOne({
    where: {
      id: orderId
    }
  })

  const productData = await transaction.update({
    where: {
      id: transactionData.idProduct
    }
  })

  const qty = productData.qty - 1
  await product.update({
    qty,
    },
    {
      where: {
        id: productData.id
      }
    }
  )

}

const sendEmail = async(status, orderId) => {

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.SYSTEM_EMAIl,
      pass: process.env.SYSTEM_PASSWORD
    }
  });

  let data = await transaction.findOne({
    where: {
      id: orderId,
    },
    attributes: {
      exclude: ['createdAt','updatedAt','password'],
    },
    include: [
      {
        model: user,
        as: "buyer",
        attributes: {
          exclude: ["createdAt","updatedAt","password","status"],
        }
      },
      {
        model: product,
        as: "product",
        attributes: {
          exclude: [
            "createdAt","updatedAt","idUser","qty","price","desc"
          ]
        }
      }
    ]
  })

  data = JSON.parse(JSON.stringify(data))

  const mailOptions = {
    from: process.env.SYSTEM_EMAIL,
    to: data.buyer.email,
    subject: "Payment status",
    text: "Your payment is <br />" + status,
    html: `<!DOCTYPE html>
            <html lang="en">
              <head>
                <meta charset="UTF-8" />
                <meta http-equiv="X-UA-Compatible" content="IE=edge" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <title>Document</title>
                <style>
                  h1 {
                    color: brown;
                  }
                </style>
              </head>
              <body>
                <h2>Product payment :</h2>
                <ul style="list-style-type:none;">
                  <li>Name : ${data.product.name}</li>
                  <li>Total payment: ${convertRupiah.convert(data.price)}</li>
                  <li>Status : <b>${status}</b></li>
                </ul>  
              </body>
            </html>`,
  }

  if (data.status != status) {
    transporter.sendMail(mailOptions, (err, info) => {
      if (err) throw err;
      console.log("Email sent: " + info.response);

      return res.send({
        status: "Success",
        message: info.response,
      });
    });
  }

}