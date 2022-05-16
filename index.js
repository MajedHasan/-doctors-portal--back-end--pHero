const express = require('express');
const app = express()
const cors = require('cors');
const jwt = require("jsonwebtoken");
require('dotenv').config()
const port = process.env.PORT || 5000
const { MongoClient, ServerApiVersion } = require('mongodb');


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


async function run() {
    try {
        await client.connect()
        const serviceCollection = client.db('doctors_portal').collection("services")
        const bookingsCollection = client.db('doctors_portal').collection("bookings")
        const usersCollection = client.db('doctors_portal').collection("users")

        app.get('/service', async (req, res) => {
            const query = {}
            const curosr = serviceCollection.find(query)
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

        app.put('/user/admin/:email', verifyJWT, async (req, res) => {
            const email = req.params.email
            const requester = req.decoded.email
            const requesterAccount = await usersCollection.findOne({ email: requester })
            if (requesterAccount.role === 'admin') {
                const filter = { email: email }
                const updateDoc = {
                    $set: { role: 'admin' }
                }
                const result = await usersCollection.updateOne(filter, updateDoc)
                res.send(result)
            }
            else {
                res.status(403).send({ message: 'forbidden' })
            }
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

        app.post("/booking", async (req, res) => {
            const booking = req.body
            const query = { treatment: booking.treatment, date: booking.date, patient: booking.patient }
            const exists = await bookingsCollection.findOne(query)
            if (exists) {
                return res.send({ success: false, booking: exists })
            }
            const result = await bookingsCollection.insertOne(booking)
            return res.send({ success: true, result })
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