const express = require('express');
const app = express()
const cors = require('cors');
const jwt = require("jsonwebtoken");
require('dotenv').config()
const port = process.env.PORT || 5000
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const nodemailer = require('nodemailer')
const sgTransport = require("nodemailer-sendgrid-transport")
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);


// MiddleTier
app.use(cors())
app.use(express.json())


// MongoDB
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.nhpml.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`;

const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

function verifyJWT(req, res, next) {
    const authHeaders = req.headers.authorization
    if (!authHeaders) {
        return res.status(401).send({ message: "UnAuthorized Access" })
    }
    const token = authHeaders.split(' ')[1]
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: "Forbidden Access" })
        }
        req.decoded = decoded
        next()
    })
}

var emailSenderOptions = {
    auth: {
        api_key: process.env.EMAIL_SENDER_API_KEY
    }
}
const emailClient = nodemailer.createTransport(sgTransport(emailSenderOptions))

function sendAppointmentEmail(booking) {
    const { patient, patientName, treatment, date, slot } = booking

    const email = {
        from: process.env.EMAIL_SENDER,
        to: patient,
        subject: `Your Appointment for ${treatment} is on ${date} at ${slot} is Confirmed`,
        text: `Your Appointment for ${treatment} is on ${date} at ${slot} is Confirmed`,
        html: `
        <div>
            <p>Hello ${patientName}</p>
            <h3>Your Appointment for  ${treatment} is confirmed</h3>
            <p>Looking forward to seeing you on ${date} at ${slot}</p>
            <h3>Our Address</h3>
            <p>Andor killa Bandorban</p>
            <p>Bangladesh</p>
            <a href="https://web.programming-hero.com">Unsubscribe</a>
        </div>
        `
    }

    emailClient.sendMail(email, function (err, info) {
        if (err) {
            console.log(err);
        }
        else {
            console.log('Message sent: ' + info);
        }
    })
}
function sendPaymentConfirmationEmail(booking) {
    const { patient, patientName, treatment, date, slot } = booking

    const email = {
        from: process.env.EMAIL_SENDER,
        to: patient,
        subject: `We have received your payment for ${treatment} is on ${date} at ${slot} is Confirmed`,
        text: `Your Payment for this Appointment ${treatment} is on ${date} at ${slot} is Confirmed`,
        html: `
        <div>
            <p>Hello ${patientName}</p>
            <h3>Thank you for your payment</h3>
            <h3>We have received your payment</h3>
            <p>Looking forward to seeing you on ${date} at ${slot}</p>
            <h3>Our Address</h3>
            <p>Andor killa Bandorban</p>
            <p>Bangladesh</p>
            <a href="https://web.programming-hero.com">Unsubscribe</a>
        </div>
        `
    }

    emailClient.sendMail(email, function (err, info) {
        if (err) {
            console.log(err);
        }
        else {
            console.log('Message sent: ' + info);
        }
    })
}


async function run() {
    try {
        await client.connect()
        const serviceCollection = client.db('doctors_portal').collection("services")
        const bookingsCollection = client.db('doctors_portal').collection("bookings")
        const usersCollection = client.db('doctors_portal').collection("users")
        const doctorCollection = client.db('doctors_portal').collection("doctors")
        const paymentCollection = client.db('doctors_portal').collection("payments")

        const verifyAdmin = async (req, res, next) => {
            const requester = req.decoded.email
            const requesterAccount = await usersCollection.findOne({ email: requester })

            if (requesterAccount.role === 'admin') {
                next()
            }
            else {
                res.status(403).send({ message: 'forbidden' })
            }
        }


        app.post('/create-payment-intent', verifyJWT, async (req, res) => {
            const service = req.body
            const price = service.price
            const amount = price * 100
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types: ['card']
            })
            res.send({ clientSecret: paymentIntent.client_secret })
        })

        app.get('/service', async (req, res) => {
            const query = {}
            const curosr = serviceCollection.find(query).project({ name: 1 })
            const services = await curosr.toArray()
            res.send(services)
        })


        app.get('/user', verifyJWT, async (req, res) => {
            const users = await usersCollection.find().toArray()
            res.send(users)
        })


        app.get('/admin/:email', async (req, res) => {
            const email = req.params.email
            const user = await usersCollection.findOne({ email: email })
            const isAdmin = user.role === 'admin'
            res.send({ admin: isAdmin })
        })

        app.put('/user/admin/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email
            const filter = { email: email }
            const updateDoc = {
                $set: { role: 'admin' }
            }
            const result = await usersCollection.updateOne(filter, updateDoc)
            res.send(result)
        })

        app.put('/user/:email', async (req, res) => {
            const email = req.params.email
            const user = req.body
            const filter = { email: email }
            const options = { upsert: true }
            const updateDoc = {
                $set: user
            }
            const result = await usersCollection.updateOne(filter, updateDoc, options)
            const token = jwt.sign({ email: email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: "1h" })
            res.send({ result, token })
        })

        // Warning :
        // This is not proper way to query.
        // After learning more about mongodb. use aggregate lookup, pipeline, match, group
        app.get('/available', async (req, res) => {
            const date = req.query.date || 'May 14, 2022'

            // step 1: get all services
            const services = await serviceCollection.find().toArray()

            // step 2: get the booking of that day
            const query = { date: date }
            const bookings = await bookingsCollection.find(query).toArray()

            // step 3: for each service, find bookings for that service
            services.forEach(service => {
                const serviceBooking = bookings.filter(b => b.treatment === service.name)
                const booked = serviceBooking.map(s => s.slot)
                const available = service.slots.filter(s => !booked.includes(s))
                service.slots = available;
            })

            res.send(services)
        })


        /*
            API Naming Convention
            app.get('/booking')         // Get all booking in this collection. or get more than one or by filter
            app.get('/booking/:id')     // get a specific booking
            app.post('/booking')        // Add a new booking
            app.patch('/booking/:id')   // 
            app.put('/booking/:id')     // upsert ==> update (if exists) or insert (if doesn't exist)
            app.delete('/booking/:id')  // 
        */

        app.get('/booking', verifyJWT, async (req, res) => {
            const patient = req.query.patient
            const decodedEmail = req.decoded.email
            // console.log(decodedEmail);
            if (patient === decodedEmail) {
                const query = { patient: patient }
                const bookings = await bookingsCollection.find(query).toArray()
                return res.send(bookings)
            }
            else {
                return res.status(403).send({ message: "Forbidden Access" })
            }
        })

        app.patch('/booking/:id', verifyJWT, async (req, res) => {
            const id = req.params.id
            const payment = req.body
            const filter = { _id: ObjectId(id) }
            const updatedDoc = {
                $set: {
                    paid: true,
                    transactionId: payment.transactionId
                }
            }

            const updatedBooking = await bookingsCollection.updateOne(filter, updatedDoc)
            const result = await paymentCollection.insertOne(payment)
            res.send(updatedBooking)
        })

        app.get('/booking/:id', verifyJWT, async (req, res) => {
            const id = req.params.id
            const query = { _id: ObjectId(id) }
            const booking = await bookingsCollection.findOne(query)
            res.send(booking)
        })

        app.post("/booking", async (req, res) => {
            const booking = req.body
            const query = { treatment: booking.treatment, date: booking.date, patient: booking.patient }
            const exists = await bookingsCollection.findOne(query)
            if (exists) {
                return res.send({ success: false, booking: exists })
            }
            const result = await bookingsCollection.insertOne(booking)
            sendAppointmentEmail(booking)
            return res.send({ success: true, result })
        })


        app.get('/doctor', verifyJWT, verifyAdmin, async (req, res) => {
            const doctors = await doctorCollection.find().toArray()
            res.send(doctors)
        })

        app.post('/doctor', verifyJWT, verifyAdmin, async (req, res) => {
            const doctor = req.body
            const result = await doctorCollection.insertOne(doctor)
            res.send(result)
        })

        app.delete('/doctor/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email
            const filter = { email: email }
            const result = await doctorCollection.deleteOne(filter)
        })

    }
    finally {

    }
}
run().catch(console.dir)


// Routes
app.get('/', (req, res) => {
    res.send("Server is Running")
})

app.listen(port, () => {
    console.log(`Server is Running on PORT : ${port}`);
})