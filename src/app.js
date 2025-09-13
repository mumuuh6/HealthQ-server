const OpenAI = require('openai')
require('dotenv').config();
const dns = require('dns');
const https = require('https');
//const dotenv = require('dotenv');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const bcrypt = require("bcrypt");
const { google } = require('googleapis');
const { spawn } = require("child_process");
const nodemailer = require('nodemailer');
const multer = require("multer");
const axios = require("axios");
const fs = require("fs");
const FormData = require("form-data");
const e = require('express');
const path = require('path')
const app = express()
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
ffmpeg.setFfmpegPath(ffmpegPath);
dns.setDefaultResultOrder('ipv4first');
app.use(express.json())
app.use(morgan('dev'))
app.use(cors({
    origin: [
        'http://localhost:3000',
        'https://healthq.vercel.app'
    ],
    credentials: true
}))
app.use(cookieParser());
const agent = new https.Agent({ keepAlive: true, maxSockets: 10 });
// const openai = new OpenAI({
//     apiKey: process.env.OPENAI_API_KEY,
//     timeout: 120000
// });
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    httpagent: agent,
    model: "whisper-1",
    timeout: 300000
});

//console.log("OpenAIi API Key:", process.env.OPENAI_API_KEY ? "Loaded" : "Not Loaded");

async function convertWebMToMP3(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .output(outputPath)
            .on('end', () => resolve(outputPath))
            .on('error', (err) => reject(err))
            .run();
    });
}

async function transcribeAudio(filePath) {
    try {
        const formData = new FormData();
        formData.append("file", fs.createReadStream(filePath));
        formData.append("model", "whisper-1");

        const response = await axios.post(
            "https://api.openai.com/v1/audio/transcriptions",
            formData,
            {
                headers: {
                    ...formData.getHeaders(),
                    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                },
                maxBodyLength: Infinity, // avoid request size issues
            }
        );

        console.log("Transcription:", response.data.text);
        return response.data.text;
        // const response =await openai.audio.transcriptions.create({
        //     file:fs.createReadStream('./uploads/1757166733210-converted.mp3'),
        //     model:"whisper-1",
        // })
        // console.log("Transcription:", response.text);
    } catch (err) {
        //console.error("Axios transcription error:", err.response?.data || err.message);
        console.error("Transcription error:", err);
        throw err;
    }
}

// MongoDB connection
const uri = `mongodb+srv://${process.env.USER_NAME}:${process.env.PASSWORD}@cluster0.4ayta.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;




// Gemini API client
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

const { apikeys } = require('googleapis/build/src/apis/apikeys');
const { model } = require('mongoose');
const { time } = require('console');


// 📂 Multer Setup (File Upload)
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, "/tmp");
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + "-" + file.originalname);
    },
});
const upload = multer({ storage: storage });

async function run() {
    try {
        console.log("✅ Successfully connected to MongoDB!");

        // Database
        const database = client.db('HealthQ')

        // Users Collection 
        const usersCollection = database.collection("users")
        const BookingCollection = database.collection("bookings")
        const medinicineCollection = database.collection("medicines")
        const cartCollection = database.collection('carts');
        const paymentCollection = database.collection('payments');

        // verify token middleware
        const verifyToken = (req, res, next) => {
            // console.log("Inside the verify token");
            // console.log("received request:", req?.headers?.authorization);
            if (!req?.headers?.authorization) {
                return res.status(401).json({ message: "Unauthorized Access!" });
            }

            // get token from the headers 
            const token = req?.headers?.authorization;
            // console.log("Received Token", token);

            jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
                if (err) {
                    console.error('JWT Verification Error:', err.message);
                    return res.status(401).json({ message: err.message });
                }
                // console.log('Decoded Token:', decoded);
                req.user = decoded;
                next();
            })
        }

        // verify admin middleware after verify token
        const verifyAdmin = async (req, res, next) => {
            const email = req.user.email;
            const query = { email: email };
            const user = await usersCollection.findOne(query);
            const isAdmin = user?.role === 'admin';
            if (!isAdmin) {
                return res.status(403).send({ message: 'forbidden access' });
            }
            next();
        }

        // JWT token create and remove APIS
        // JWT token create API 
        app.post('/jwt/create', async (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '7h' });
            res.send({ token })
        })

        // stored user into the mongodb API 
        app.post('/signup', async (req, res) => {
            try {
                const { sociallogin } = req.query
                if (sociallogin) {
                    const body = req.body

                    const existingUser = await usersCollection.findOne({ email: body?.email });

                    if (existingUser) {
                        return res.json({
                            status: false,
                            message: 'User already exists, use another email address',
                            data: result
                        });
                    }

                    const updateBody = {
                        ...body, failedAttempts: 0, block: false
                    }

                    const result = await usersCollection.insertOne(updateBody)
                    return res.json({
                        status: true,
                        message: "User added successfully",
                        result
                    })
                }
                else {
                    const { password, userType, ...user } = req.body;

                    const existingUser = await usersCollection.findOne({ email: user?.email });



                    if (existingUser) {
                        return res.json({
                            status: false,
                            message: 'User already exists, use another email address',
                            data: result
                        });
                    }
                    if (userType === 'doctor') {
                        const existingpeople = await usersCollection.find({ userType: userType }).toArray()

                        const doctorid = existingpeople.length + 1;

                        const hashedPass = await bcrypt.hash(password, 10)

                        const withRole = {
                            ...user, password: hashedPass, userType,
                            Doctor_ID: `D0000${doctorid}`, failedAttempts: 0, block: false
                        }
                        const insertResult = await usersCollection.insertOne(withRole);
                        return res.json({
                            status: true,
                            message: 'User added successfully',
                            data: insertResult
                        });
                    }
                    const hashedPass = await bcrypt.hash(password, 10)

                    const withRole = {
                        ...user, password: hashedPass, userType,
                        failedAttempts: 0, block: false
                    }
                    const insertResult = await usersCollection.insertOne(withRole);
                    return res.json({
                        status: true,
                        message: 'User added successfully',
                        data: insertResult
                    });
                }

            } catch (error) {
                console.error('Error adding/updating user:', error);
                res.status(500).json({
                    status: false,
                    message: 'Failed to add or update userr',
                    error: error.message
                });
            }
        });

        // user blocking API 
        app.post('/signin/:email', async (req, res) => {
            const email = req.params.email

            const { password, ...userInfo } = req.body

            let user = await usersCollection.findOne({ email })
            if (!user) {
                res.json({ status: false, message: "User not found" })
                return
            }

            if (user?.block) {
                res.json({ status: false, message: "This Email has been blocked, Please contact with admin!" })
                return
            }

            const match = await bcrypt.compare(password, user?.password)

            if (!match) {
                if (user?.failedAttempts == 4) {
                    await usersCollection.updateOne({ email: email }, {
                        $set: {
                            block: true
                        }
                    })
                    res.json({ status: false, message: "Your Email Has been blocked Please contact with admin!" })
                    return
                }
                else {
                    const updateFailedAttempts = {
                        $inc: {
                            failedAttempts: 1
                        }
                    }
                    await usersCollection.updateOne({ email: email }, updateFailedAttempts)
                    user = await usersCollection.findOne({ email: email })
                    res.json({ status: false, message: `Incorrect Password, Left ${5 - user?.failedAttempts} Attempts`, failedAttempts: user?.failedAttempts })
                    return
                }
            }

            await usersCollection.updateOne({ email: email }, {
                $set: {
                    failedAttempts: 0
                }
            })

            const updatedData = {
                $set: {
                    lastLoginTime: userInfo?.lastLoginTime
                }
            };

            await usersCollection.updateOne({ email: user?.email }, updatedData);
            res.json({
                status: true,
                userInfo: user,
                message: "Login Successfully"
            })
        })

        // get user for auth js API
        app.get('/signin/:email', async (req, res) => {
            const email = req.params.email
            const userExist = await usersCollection.findOne({ email: email })
            const newuser = {
                ...userExist,
                lastLoginTime: new Date().toISOString()
            }
            if (!userExist) {
                res.json({ status: false, message: "User Not Found" })
                return
            }
            res.json({
                status: true,
                userInfo: newuser,
            })
        })

        app.patch('/profile/:email', async (req, res) => {
            const email = req.params.email;
            // console.log("Updating profile for email:", email);
            const body = req.body;
            console.log("Request body:", body);
            let user = await usersCollection.findOne({ email })
            if (!user) {
                res.json({ status: false, message: "User not found" })
                return
            }
            try {
                const updateFields = {};

                if (user.userType === 'patient') {
                    // Direct fields
                    if (body.name) updateFields.name = body.name;
                    if (body.phone) updateFields.phone = body.phone;
                    if (body.dateOfBirth) updateFields.dateOfBirth = body.dateOfBirth;
                    if (body.gender) updateFields.gender = body.gender;
                    if (body.address) updateFields.address = body.address;
                    if (body.age) updateFields.age = body.age;

                    // Emergency contact
                    if (body.emergencyContact) {
                        if (body.emergencyContact.name) updateFields["emergencyContact.name"] = body.emergencyContact.name;
                        if (body.emergencyContact.relationship) updateFields["emergencyContact.relationship"] = body.emergencyContact.relationship;
                        if (body.emergencyContact.phone) updateFields["emergencyContact.phone"] = body.emergencyContact.phone;
                    }

                    // Medical info
                    if (body.medicalInfo) {
                        if (body.medicalInfo.allergies) updateFields["medicalInfo.allergies"] = body.medicalInfo.allergies;
                        if (body.medicalInfo.medications) updateFields["medicalInfo.medications"] = body.medicalInfo.medications;
                        if (body.medicalInfo.conditions) updateFields["medicalInfo.conditions"] = body.medicalInfo.conditions;
                        if (body.medicalInfo.bloodType) updateFields["medicalInfo.bloodType"] = body.medicalInfo.bloodType;
                    }

                    // Insurance
                    if (body.insurance) {
                        if (body.insurance.provider) updateFields["insurance.provider"] = body.insurance.provider;
                        if (body.insurance.policyNumber) updateFields["insurance.policyNumber"] = body.insurance.policyNumber;
                        if (body.insurance.groupNumber) updateFields["insurance.groupNumber"] = body.insurance.groupNumber;
                        if (body.insurance.primaryHolder) updateFields["insurance.primaryHolder"] = body.insurance.primaryHolder;
                    }
                }
                else if (user.userType === 'doctor') {
                    // Direct fields
                    if (body.name) updateFields.name = body.name;
                    if (body.Doctor_Type) updateFields.Doctor_Type = body.Doctor_Type;
                    if (body.phone) updateFields.phone = body.phone;
                    if (body.address) updateFields.address = body.address;
                    if (body.bio) updateFields.bio = body.bio;
                    if (body.availableDays) updateFields.availableDays = body.availableDays;
                    if (body.email) updateFields.email = body.email;
                    if (body.age) updateFields.Doctor_Age = body.age;
                    if (body.timeSlotId) updateFields.timeSlotId = body.timeSlotId;

                    // // Education array
                    // if (Array.isArray(body.education)) {
                    //     updateFields.education = body.education;
                    // }

                    // // Certifications array
                    // if (Array.isArray(body.certifications)) {
                    //     updateFields.certifications = body.certifications;
                    // }
                }
                console.log("Update fields:", updateFields);
                const result = await usersCollection.updateOne(
                    { email: email },
                    { $set: updateFields },
                    { upsert: true }
                );

                res.status(200).json({
                    message: "Profile updated successfully",
                    result
                });
            } catch (error) {
                console.error("Error updating profile:", error);
                res.status(500).json({ message: "Server error" });
            }
        })
        //get all medicines API
        app.get('/medicines', async (req, res) => {


            const user = await medinicineCollection
                .find().toArray();
            //console.log(user.length);
            if (!user) {
                return res.status(404).json({ message: "User not found" });
            }
            res.status(200).json({
                message: "Profile fetched successfully",
                user
            });
        });
        //get medicine by id API
        app.get('/medicines/:slug', async (req, res) => {
            const slug = req.params.slug;
            const medicine = await medinicineCollection.findOne({ slug: slug });
            if (!medicine) {
                return res.status(404).json({ message: "Medicine not found" });
            }
            res.status(200).json({
                // message: "Medicine fetched successfully",
                medicine
            });
        });
        //get Booked appointments API
        app.get('/booked-appointments/:email', async (req, res) => {
            const email = req.params.email
            const query = { email: email }
            const bookedAppointments = await BookingCollection.find(query).toArray();
            if (bookedAppointments.length === 0) {
                return res.json({
                    status: false,
                    message: "No appointments found for this email"
                });
            }
            res.json({
                status: true,
                message: "Booked appointments fetched successfully",
                data: bookedAppointments
            });
        })
        // reset password API 
        // app.get('/reset-password/:email', async (req, res) => {
        //     const email = req.params.email
        //     const userExist = await usersCollection.findOne({ email: email })
        //     if (!userExist) {
        //         res.json({ status: false, message: "User Not Found!" })
        //         return
        //     }

        //     const expireUserExist = await expireCollection.findOne({ email: email })

        //     if (!expireUserExist) {
        //         await expireCollection.insertOne({
        //             email: email,
        //             expiresAt: new Date(Date.now() + 1000 * 60 * 5), // 5 min
        //         })
        //     }

        //     if (expireUserExist) {
        //         await expireCollection.updateOne({ email: email }, {
        //             $set: {
        //                 expiresAt: new Date(Date.now() + 1000 * 60 * 5), // 5 min
        //             }
        //         })
        //     }

        //     const html = `
        //     <!DOCTYPE html>
        //     <html lang="en">
        //       <head>
        //         <meta charset="UTF-8" />
        //         <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        //         <title>Reset Your Password - QuizMania</title>
        //         <style>
        //           @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap');

        //           body {
        //             font-family: 'Poppins', sans-serif;
        //             background-color: #f3f4f6;
        //             margin: 0;
        //             padding: 0;
        //             color: #1f2937;
        //           }

        //           .email-container {
        //             max-width: 600px;
        //             margin: 40px auto;
        //             background-color: #ffffff;
        //             border-radius: 10px;
        //             overflow: hidden;
        //             box-shadow: 0 6px 20px rgba(0, 0, 0, 0.1);
        //           }

        //           .email-header {
        //             background-color: #8b5cf6;
        //             padding: 30px 20px;
        //             text-align: center;
        //           }

        //           .logo {
        //             font-size: 26px;
        //             font-weight: 700;
        //             color: #ffffff;
        //             letter-spacing: 1px;
        //           }

        //           .email-body {
        //             padding: 40px 30px;
        //           }

        //           .greeting {
        //             font-size: 20px;
        //             font-weight: 600;
        //             margin-bottom: 20px;
        //           }

        //           .message {
        //             font-size: 16px;
        //             line-height: 1.6;
        //             margin-bottom: 25px;
        //           }

        //           .reset-button {
        //             display: inline-block;
        //             background-color: #8b5cf6;
        //             color: #ffffff !important;
        //             text-decoration: none;
        //             padding: 14px 36px;
        //             border-radius: 8px;
        //             font-weight: 600;
        //             font-size: 16px;
        //             transition: background-color 0.3s ease;
        //           }

        //           .reset-button:hover {
        //             background-color: #7c3aed;
        //           }

        //           .warning {
        //             font-size: 14px;
        //             color: #6b7280;
        //             margin-top: 30px;
        //             font-style: italic;
        //           }

        //           .email-footer {
        //             background-color: #f9fafb;
        //             padding: 20px;
        //             text-align: center;
        //             font-size: 14px;
        //             color: #6b7280;
        //           }

        //           @media only screen and (max-width: 600px) {
        //             .email-body {
        //               padding: 30px 20px;
        //             }

        //             .reset-button {
        //               width: 100%;
        //               padding: 14px 0;
        //             }

        //             .logo {
        //               font-size: 22px;
        //             }
        //           }
        //         </style>
        //       </head>
        //       <body>
        //         <div class="email-container">
        //           <div class="email-header">
        //             <div class="logo">QuizMania</div>
        //           </div>
        //           <div class="email-body">
        //             <div class="greeting">Hi, ${userExist.username}</div>
        //             <div class="message">
        //               We received a request to reset the password associated with your QuizMania account.
        //               Click the button below to continue with the reset process.
        //             </div>
        //             <a href="https://quizzmaniaa.vercel.app/auth/reset-password?secretcode=${userExist?._id}" class="reset-button">Reset Password</a>
        //             <div class="warning">
        //               This link will expire in 5 minutes for your security. If you didn’t request this, no action is required.
        //             </div>
        //           </div>
        //           <div class="email-footer">
        //             &copy; ${new Date().getFullYear()} QuizMania. All rights reserved.
        //           </div>
        //         </div>
        //       </body>
        //     </html>
        //     `;


        //     const transporter = nodemailer.createTransport({
        //         service: "gmail",
        //         auth: {
        //             user: process.env.GOOGLE_ACCOUNT_USER,
        //             pass: process.env.GOOGLE_ACCOUNT_PASS,
        //         },
        //     })

        //     const info = await transporter.sendMail({
        //         from: `"QuizMania" <noreply@quizmania.com>`,
        //         to: email,
        //         subject: `Reset your QuizMania password`,
        //         html: html,
        //     })


        //     res.json({
        //         status: true,
        //         message: "Email send successfully, Check inbox or spam of email",
        //         email: email,
        //         info: info,
        //     });
        // })

        // reset password request confirmation API 
        app.patch('/reset-password/:id', async (req, res) => {
            try {
                const id = req.params.id;
                const { password } = req.body;

                const user = await usersCollection.findOne({ _id: new ObjectId(id) });

                const expireUser = await expireCollection.findOne({ email: user?.email })

                const now = new Date();
                const expiresAt = new Date(expireUser?.expiresAt)

                const fiveMinutesInMs = 1000 * 60 * 5;

                if (now.getTime() - expiresAt.getTime() > fiveMinutesInMs) {
                    res.json({
                        expired: true,
                    })
                    return
                }

                if (!user) {
                    return res.status(404).json({
                        status: false,
                        message: "User not found"
                    });
                }

                const hashedPass = await bcrypt.hash(password, 10);

                const updateDoc = {
                    $set: { password: hashedPass }
                };

                await usersCollection.updateOne({ _id: new ObjectId(id) }, updateDoc);

                res.json({
                    status: true,
                    message: "Password successfully changed"
                });

            } catch (error) {
                console.error("Reset password error:", error);
                res.status(500).json({
                    status: false,
                    message: "Internal server error"
                });
            }
        });
        //book appointment API
        app.post('/book-appointment', async (req, res) => {
            const body = req.body
            const doctorEmail = body.docotorEmail;
            const date = body.date;
            const timeSlotId = body.timeSlotId;

            // Find how many existing bookings match this doctor, date, and slot
            const count = await BookingCollection.countDocuments({
                docotorEmail: doctorEmail,
                date: date,
                timeSlotId: timeSlotId,
            });
            // Assign queue position
            const queuePosition = count + 1;
            // Add it to the body
            body.queuePosition = queuePosition;

            // Save to DB
            //const result = await BookingCollection.insertOne(body);
            const insertResult = await BookingCollection.insertOne(body)
            const bookingId = insertResult.insertedId;
            //call queue tie prediction api
            let estimatedWaitTime = null;
            try {
                const predictionRes = await axios.get(`https://queuepredictapi-production.up.railway.app/predict_queue_time/?booking_id=${bookingId}`);

                estimatedWaitTime = predictionRes.data.Predicted_Queue_Time;
            }
            catch (error) {
                console.error("Queue time prediction error:", error);
            }
            if (estimatedWaitTime) {
                await BookingCollection.updateOne(
                    { _id: bookingId },
                    { $set: { estimatedWaitTime } }
                );
            }
            res.json({
                status: true,
                message: "Appointment Booked Successfully",
                data: { ...insertResult, estimatedWaitTime }
            })
        })

        app.get('/patient/active-queue/:email', async (req, res) => {
            try {
                const { email } = req.params;

                if (!email)
                    return res.status(400).json({ status: false, message: "Email is required" });

                // Get start and end of today in UTC
                const now = new Date();
                const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0));
                const tomorrow = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0));

                // Convert to DB-style ISO string with +00:00
                const todayStr = today.toISOString().replace('Z', '+00:00');
                const tomorrowStr = tomorrow.toISOString().replace('Z', '+00:00');

                console.log("today:", todayStr);      // e.g., 2025-08-25T00:00:00.000+00:00
                console.log("tomorrow:", tomorrowStr); // e.g., 2025-08-26T00:00:00.000+00:00

                // Fetch appointments for today with queuePosition
                const todaysAppointments = await BookingCollection.find({
                    email,
                    status: 'upcoming',
                    queuePosition: { $exists: true, $ne: null },
                    date: { $gte: todayStr, $lt: tomorrowStr }
                }).toArray();

                if (!todaysAppointments.length) {
                    return res.json({ status: true, message: "No active queue today", data: null });
                }

                // Sort by queuePosition (lowest number = next in queue)
                const activeQueue = todaysAppointments.sort((a, b) => a.queuePosition - b.queuePosition)[0];

                return res.json({
                    status: true,
                    message: "Active queue fetched successfully",
                    data: activeQueue
                });

            } catch (error) {
                console.error(error);
                return res.status(500).json({ status: false, message: "Server error", error });
            }
        });


        app.get("/current-patient/:doctorEmail", async (req, res) => {
            try {
                const doctorEmail = req.params.doctorEmail;

                // Use local date
                const today = new Date();
                const todayStr = today.getFullYear() + "-" +
                    String(today.getMonth() + 1).padStart(2, "0") + "-" +
                    String(today.getDate()).padStart(2, "0");

                const patient = await BookingCollection
                .find({
                    docotorEmail: doctorEmail,
                    status: 'upcoming',
                    date: { $regex: `^${todayStr}` },

                })
                .sort({ queuePosition: 1 })
                .toArray();

                if (!patient.length) return res.json({ status: true, data: { currentPatient: null, queue: [] } });

                res.json({
                    status: true,
                    data:
                    {
                        currentPatient:
                        {
                            id: patient[0]._id.toString(),
                            name: patient[0].patientName,
                            appointmentTime: patient[0].timeSlotId,
                            status: patient[0].status,
                            queuePosition: patient[0].queuePosition,
                            meetlink: patient[0].meetlink,
                            appointmentType: patient[0].Reason,
                        },
                        queue: patient.slice(1).map((p) => ({
                            id: p._id.toString(),
                            name: p.patientName,
                            appointmentTime: p.timeSlotId,
                            status: p.status,
                            queuePosition: p.queuePosition,
                            meetlink: p.meetlink,
                            appointmentType: p.Reason,
                            waitTime:p.estimatedWaitTime
                        }))
                    },
                });
            } catch (error) {
                console.error(error);
                res.status(500).json({ status: false, message: "Server error" });
            }
        });
app.post("/queue/complete/:patientId", async (req, res) => {
  try {
    const { patientId } = req.params;

    // ✅ Mark current patient as completed
    await BookingCollection.updateOne(
      { _id: new ObjectId(patientId) },
      { $set: { status: "completed" } }
    );

    res.json({ status: true, message: "Patient marked as completed" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: false, message: "Server error" });
  }
});

        app.get('/findpatient/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await BookingCollection.findOne(query);
            res.json(result)
        })
        app.patch('/update-consultation/:patientId', async (req, res) => {
            const patientId = req.params.patientId;
            const { consultationNotes, prescriptions, followUpDate } = req.body;
            let updateFields = {};
            if (consultationNotes) updateFields.consultationNotes = consultationNotes;
            if (prescriptions) updateFields.prescriptions = prescriptions;
            if (followUpDate) updateFields.followUpDate = followUpDate;
            console.log(updateFields)
            const result2 = await BookingCollection.updateOne({ _id: new ObjectId(patientId) }, { $set: updateFields });
            res.json({ status: true, message: "Consultation details updated", result2 })
        })

        app.get('/doctor/:role', async (req, res) => {
            const role = req.params.role
            const query = { userType: role }
            const doctors = await usersCollection.find(query).toArray();
            res.json({
                status: true,
                message: "Doctors fetched successfully",
                data: doctors
            })
        })
        // find the role of user 
        app.get('/find/role/:email', async (req, res) => {
            try {
                const email = req.params.email;
                const user = await usersCollection.findOne({ email: email });
                if (!user) {
                    return res.status(404).json({ error: "User not found" });
                }
                const query = { Doctor_ID: user?.Doctor_ID.toString() };
                const doctorpatient = await BookingCollection.find(
                    query,
                ).toArray();
                if (!doctorpatient) {
                    return res.status(404).json({ error: "No patients found for this doctor" });
                }
                res.json({
                    userType: user.userType,
                    PatientData: doctorpatient || null,
                });
            } catch (error) {
                console.error("Error fetching user role:", error);
                res.status(500).json({ error: "Internal Server Error" });
            }
        });
        app.get('/schedule/:email', async (req, res) => {
            try {
                const email = req.params.email;
                const bookings = await BookingCollection.find({ docotorEmail: email }).toArray();

                if (!bookings) {
                    return res.status(404).json({ error: "Booking not found for this Email" });
                }
                const formatted = bookings.map((b) => ({
                    ...b,
                    id: b._id,
                    patient: b.patientName,
                    time: b.timeSlotId,
                    duration: b.duration || "30 mins",
                    type: b.Reason,
                    status: b.status || "confirmed",
                    date: new Date(b.date).toISOString().split("T")[0],
                }));
                res.json({
                    status: true,
                    data: formatted
                });
            }
            catch (error) {
                console.error("Error fetching schedule:", error);
                res.status(500).json({ error: "Internal Server Error" });
            }

        })
        // Upload audio and save to 'uploads/' folder
        // app.post("/upload-audio/:id", upload.single("audio"), async (req, res) => {
        //     try {
        //         const appointmentId = req.params.id;
        //         //console.log(appointmentId, 'id')
        //         const file = req.file;
        //         //console.log(file, '1');
        //         if (!file) {
        //             return res.status(400).json({ error: "No file uploaded" });
        //         }
        //         const mp3path = path.join('uploads', `${Date.now()}-converted.mp3`);
        //         await convertWebMToMP3(file.path, mp3path);
        //         console.log('File converted to MP3:', mp3path);
        //         // const transcript = await transcribeWithWhisper(file.path);
        //         const transcript = await transcribeAudio(mp3path);
        //         if (!transcript) {
        //             return res.status(500).json({ error: "Transcription failed" });
        //         }
        //         const prompt = `
        // Extract the following medical details from the transcript below.
        // Output in JSON format with these keys:
        // bp, pulse, temperature, allergies, chief_complaint, history_of_patient_illness, followup_instruction, next_appointment

        // Transcript:
        // ${transcript}
        // `;

        // const response = await openai.chat.completions.create({
        //     model: "gpt-4o-mini",
        //     messages: [
        //         { role: "system", content: "You are a helpful medical assistant." },
        //         { role: "user", content: prompt },
        //     ],
        //     temperature: 0,
        // });

        // // Parse GPT output JSON
        // const gptOutput = response.choices[0].message?.content || "{}";
        // let structuredData;
        // try {
        //     structuredData = JSON.parse(gptOutput);
        // } catch (err) {
        //     structuredData = { error: "Failed to parse GPT output" };
        // }
        // console.log('Extracted structured data:', structuredData);
        //         res.json({ message: "File uploaded successfully", path: file.path, transcript,structuredData });
        //     } catch (err) {
        //         console.error(err);
        //         res.status(500).json({ error: "Server error" });
        //     }
        // });
        app.post("/upload-audio/:id", upload.single("audio"), async (req, res) => {
            try {
                const appointmentId = req.params.id;
                const file = req.file;

                if (!file) {
                    return res.status(400).json({ error: "No file uploaded" });
                }

                const mp3path = path.join('/tmp', `${Date.now()}-converted.mp3`);
                await convertWebMToMP3(file.path, mp3path);
                console.log('File converted to MP3:', mp3path);

                const transcript = await transcribeAudio(mp3path);
                if (!transcript) {
                    return res.status(500).json({ error: "Transcription failed" });
                }

                // GPT prompt to extract structured medical data
                const prompt = `
Extract the following medical details from the transcript below.
Output strictly in JSON format with these keys:
bp, pulse, temperature, allergies, chief_complaint, history_of_patient_illness, followup_instruction, next_appointment.

If any field is not mentioned, set its value to "Not mentioned".

Transcript:
${transcript}
`;

                const response = await openai.chat.completions.create({
                    model: "gpt-4o-mini",
                    messages: [
                        { role: "system", content: "You are a helpful medical assistant." },
                        { role: "user", content: prompt },
                    ],
                    temperature: 0,
                });

                // Get raw GPT output
                const gptOutput = response.choices[0].message?.content || "{}";

                // Robust JSON extraction using regex (handles GPT extra text or formatting)
                let structuredData = {};
                try {
                    // Match the first JSON object in the GPT output
                    const match = gptOutput.match(/\{[\s\S]*\}/);
                    structuredData = match ? JSON.parse(match[0]) : {};
                } catch (err) {
                    structuredData = { error: "Failed to parse GPT output" };
                }

                console.log('Extracted structured data:', structuredData);

                res.json({
                    message: "File uploaded and processed successfully",
                    path: file.path,
                    transcript,
                    structuredData
                });

            } catch (err) {
                console.error(err);
                res.status(500).json({ error: "Server error" });
            }
        });



        //google auth API
        app.get('/auth/google', (req, res) => {
            const email = req.query.email;
            const redirectPath = req.query.redirect

            const oauth2Client = new google.auth.OAuth2(
                process.env.GOOGLE_Client_ID,
                process.env.GOOGLE_Client_Secret,
                process.env.GOOGLE_REDIRECT_URI
            );
            //const state = JSON.stringify({ email: 'mahmudaaktermumu7@gmail.com' });

            //console.log("j",process.env.GOOGLE_REDIRECT_URI)
            const scopes = [
                'https://www.googleapis.com/auth/calendar.events',
                'https://www.googleapis.com/auth/userinfo.email',
                'https://www.googleapis.com/auth/userinfo.profile'
            ];

            const authUrl = oauth2Client.generateAuthUrl({
                access_type: 'offline',
                scope: scopes,
                prompt: 'consent',
                state: JSON.stringify({ email: email, redirect: redirectPath }) // Pass the email in state
            });

            res.redirect(authUrl);
        });

        app.get('/api/google/callback', async (req, res) => {

            const code = req.query.code;
            const state = JSON.parse(req.query.state || '{}');
            const email = state.email;
            const redirectPath = state.redirect;
            //console.log('State email:', email,state); 
            if (!code || !email) {
                return res.status(400).send('Invalid request');
            }
            //console.log('Received code:', code);
            const oauth2Client = new google.auth.OAuth2(
                process.env.GOOGLE_Client_ID,
                process.env.GOOGLE_Client_Secret,
                process.env.GOOGLE_REDIRECT_URI
            );

            try {
                const { tokens } = await oauth2Client.getToken(code);
                oauth2Client.setCredentials(tokens);
                //console.log('tokens', tokens);
                // Save tokens to MongoDB for the doctor
                // const doctorsCollection = client.db('HealthQ').collection('users');
                const existingUser = await usersCollection.findOne({ email });
                let updateFields = {
                    "googleTokens.access_token": tokens.access_token,
                    "googleTokens.expiry_date": tokens.expiry_date,
                };
                if (tokens.refresh_token) {
                    updateFields["googleTokens.refresh_token"] = tokens.refresh_token;
                } else if (existingUser?.googleTokens?.refresh_token) {
                    // preserve the old refresh_token
                    updateFields["googleTokens.refresh_token"] =
                        existingUser.googleTokens.refresh_token;
                }
                await usersCollection.updateOne(
                    { email },  // or req.user.email if using auth
                    { $set: updateFields },
                    { upsert: true }
                );
                //console.log('result', result);
                res.redirect(`https://healthq.vercel.app/${redirectPath}?calendar=connected`);
                //res.send('Google Calendar connected successfully!');

            } catch (error) {
                console.error(error);
                res.status(500).send('Error connecting Google Calendar');
                res.redirect(`https://healthq.vercel.app/${redirectPath}?calendar=error`);
            }
        });

        app.post('/transcribe-meet/:appointmentId', upload.single('audio'), async (req, res) => {
            try {
                const appointmentId = req.params.appointmentId;
                const file = req.file;
                console.log(file, '2')
                if (!file) {
                    return res.status(400).json({ status: false, message: "No audio uploaded" });
                }
                // const transcript=await transcribeWithWhisper(file.path);
                // await BookingCollection.updateOne({_id:new ObjectId(appointmentId)},{$set:{transcript}});
                // res.json({status:true,transcript})


            } catch (err) {
                console.error(err);
                res.status(500).json({ status: false, message: "Transcribe failed", error: err.message });
            }
        });

        app.post('/api/google/create-event', async (req, res) => {
            try {
                const { doctorEmail, patientEmail, date, startTime, endTime, summary } = req.body;
                if (!doctorEmail || !patientEmail || !date || !startTime || !endTime) {
                    return res.status(400).json({ status: false, message: 'Missing required fields' });
                }
                //console.log(startTime, endTime)
                const doctor = await usersCollection.findOne({ email: doctorEmail });
                if (!doctor?.googleTokens) return res.status(400).send('Doctor not connected to Google');

                const oauth2Client = new google.auth.OAuth2(
                    process.env.GOOGLE_Client_ID,
                    process.env.GOOGLE_Client_Secret
                );
                oauth2Client.setCredentials(doctor.googleTokens);

                const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
                const [startHours, startMinutes] = startTime.split(':').map(Number);
                const [endHours, endMinutes] = endTime.split(':').map(Number);
                const startDate = new Date(date);
                startDate.setHours(startHours, startMinutes, 0, 0);

                const endDate = new Date(date);
                endDate.setHours(endHours, endMinutes, 0, 0);
                // Combine date and time into a Date object




                const event = {
                    summary: summary || 'HealthQ Appointment',
                    description: `Appointment with ${patientEmail}`,
                    start: { dateTime: startDate.toISOString(), timeZone: 'Asia/Dhaka' },
                    end: { dateTime: endDate.toISOString(), timeZone: 'Asia/Dhaka' },
                    attendees: [{ email: patientEmail }],
                    conferenceData: { createRequest: { requestId: `meet-${Date.now()}` } },
                    reminders: {
                        useDefault: false,
                        overrides: [
                            { method: 'email', minutes: 30 }, // email 30 min before
                            { method: 'popup', minutes: 10 } // 10 minutes before
                        ]
                    }
                };


                const response = await calendar.events.insert({
                    calendarId: 'primary',
                    resource: event,
                    conferenceDataVersion: 1,
                    sendUpdates: 'all'
                });
                const appointment = {
                    doctorEmail,
                    patientEmail,
                    date: startDate,
                    time: startTime,
                    summary: summary || 'HealthQ Appointment',
                    meetLink: response.data.hangoutLink,
                    eventId: response.data.id,

                    status: 'upcoming'
                };
                await BookingCollection.updateOne(
                    { doctorEmail, patientEmail, date: startDate },
                    { $set: appointment },
                    { upsert: true }
                );
                res.json({ status: true, meetLink: response.data.hangoutLink, eventId: response.data.id });
            }
            catch (error) {
                console.error("Error creating event:", error);
                res.status(500).json({ status: false, message: 'Failed to create event', error: error.message });
            }

        });



        app.post("/predict", upload.single("photo"), async (req, res) => {
            try {
                const filePath = req.file.path;
                const formData = new FormData();
                formData.append("image", fs.createReadStream(filePath));

                const response = await axios.post("http://127.0.0.1:8000/predict", formData, {
                    headers: { "Content-Type": "multipart/form-data" },
                });

                res.json(response.data);
            } catch (error) {
                console.error("Upload error:", error.message);
                res.status(500).json({ message: "Server error during image upload" });
            }
        });
        const getTransactionId = () => {
            return `tran_${Date.now()}`;
        }
        app.post('/cart', async (req, res) => {
            const payload = req.body;
            const result = await cartCollection.insertOne(payload);

            const transactionId = getTransactionId()

            const data = {
                store_id: process.env.SSL_STORE_ID,
                store_passwd: process.env.SSL_STORE_PASS,
                total_amount: payload.amount,
                currency: "BDT",
                tran_id: transactionId,
                success_url: `${process.env.SSL_SUCCESS_BACKEND_URL}?transactionId=${transactionId}&amount=${payload.amount}&status=success`,
                fail_url: `${process.env.SSL_FAIL_BACKEND_URL}?transactionId=${transactionId}&amount=${payload.amount}&status=fail`,
                cancel_url: `${process.env.SSL_CANCEL_BACKEND_URL}?transactionId=${transactionId}&amount=${payload.amount}&status=cancel`,
                shipping_method: "N/A",
                product_name: "Medicine",
                product_category: "Service",
                product_profile: "general",
                cus_name: payload.name,
                cus_email: payload.email,
                cus_add2: "N/A",
                cus_city: "Dhaka",
                cus_state: "Dhaka",
                cus_postcode: "1000",
                cus_country: "Bangladesh",
                cus_fax: "01711111111",
                ship_name: "N/A",
                ship_add1: "N/A",
                ship_add2: "N/A",
                ship_city: "N/A",
                ship_state: "N/A",
                ship_postcode: 1000,
                ship_country: "N/A",
            }

            const response = await axios({
                method: "POST",
                url: process.env.SSL_PAYMENT_API,
                data: data,
                headers: { "Content-Type": "application/x-www-form-urlencoded" }
            })


            await paymentCollection.insertOne({
                medicineCartId: result.insertedId,
                status: "UNPAID",
                transactionId: transactionId,
                amount: payload.amount,
                email: payload.email,
                name: payload.name
            })

            return res.json({
                success: true,
                message: "Get Gateway PageURL",
                paymentLink: response.data.GatewayPageURL,
                payload
            })

        });

        // SSL Commerz Payment Related APIs
        // app.post("/payment/init", async (req, res) => {

        //     const payload = req.body

        //     const transactionId = getTransactionId()
        //     try {
        //         const data = {
        //             store_id: process.env.SSL_STORE_ID,
        //             store_passwd: process.env.SSL_STORE_PASS,
        //             total_amount: payload.amount,
        //             currency: "BDT",
        //             tran_id: transactionId,
        //             success_url: `${process.env.SSL_SUCCESS_BACKEND_URL}?transactionId=${transactionId}&amount=${payload.amount}&status=success`,
        //             fail_url: `${process.env.SSL_FAIL_BACKEND_URL}?transactionId=${transactionId}&amount=${payload.amount}&status=fail`,
        //             cancel_url: `${process.env.SSL_CANCEL_BACKEND_URL}?transactionId=${transactionId}&amount=${payload.amount}&status=cancel`,
        //             shipping_method: "N/A",
        //             product_name: "Medicine",
        //             product_category: "Service",
        //             product_profile: "general",
        //             cus_name: payload.name,
        //             cus_email: payload.email,
        //             cus_add2: "N/A",
        //             cus_city: "Dhaka",
        //             cus_state: "Dhaka",
        //             cus_postcode: "1000",
        //             cus_country: "Bangladesh",
        //             cus_fax: "01711111111",
        //             ship_name: "N/A",
        //             ship_add1: "N/A",
        //             ship_add2: "N/A",
        //             ship_city: "N/A",
        //             ship_state: "N/A",
        //             ship_postcode: 1000,
        //             ship_country: "N/A",
        //         }

        //         const response = await axios({
        //             method: "POST",
        //             url: process.env.SSL_PAYMENT_API,
        //             data: data,
        //             headers: { "Content-Type": "application/x-www-form-urlencoded" }
        //         })


        //         await paymentCollection.insertOne({
        //             medicineCartId: payload.cartId,
        //             status: "UNPAID",
        //             transactionId: transactionId,
        //             amount: payload.amount,
        //             email: payload.email,
        //             name: payload.name
        //         })

        //         return res.json({
        //             success: true,
        //             message: "Get Gateway PageURL",
        //             paymentLink: response.data.GatewayPageURL,
        //             payload
        //         })
        //     }
        //     catch (error) {
        //         console.log("Payment Error Occurred", error);
        //         throw new Error(error.message)
        //     }
        // })

        app.post("/payment/success", async (req, res) => {
            const query = req.query;

            const updatedPayment = await paymentCollection.updateOne(
                { transactionId: query.transactionId },
                { $set: { status: "PAID" } }
            );

            if (!updatedPayment) {
                throw new Error("Payment Not Found");
            }

            const redirectUrl = `${process.env.SSL_SUCCESS_FRONTEND_URL}?transactionId=${query.transactionId}&message=Payment Complete Successfully&amount=${query.amount}&status=${query.status}`;
            console.log("Redirecting to:", redirectUrl);

            return res.redirect(redirectUrl);

        });

        app.post("/payment/fail", async (req, res) => {
            const query = req.query

            let updatedPayment = await paymentCollection.updateOne(
                {
                    transactionId: query.transactionId
                },
                { $set: { status: "FAILED" } }
            )

            if (!updatedPayment) {
                throw new Error("Payment Not Found")
            }

            const redirectUrl = `${process.env.SSL_FAIL_FRONTEND_URL}?transactionId=${query.transactionId}&message=${"Payment Failed"}&amount=${query.amount}&status=${query.status}`

            return res.redirect(redirectUrl)

        })

        app.post("/payment/cancel", async (req, res) => {
            const query = req.query

            let updatedPayment = await paymentCollection.updateOne(
                {
                    transactionId: query.transactionId
                },
                { $set: { status: "CANCELED" } }
            )

            if (!updatedPayment) {
                throw new Error("Payment Not Found")
            }

            const redirectUrl = `${process.env.SSL_CANCEL_FRONTEND_URL}?transactionId=${query.transactionId}&message=${"Payment Canceled"}&amount=${query.amount}&status=${query.status}`

            return res.redirect(redirectUrl)

        })

        app.post("/payment/again/:paymentId", async (req, res) => {
            const paymentId = req.params.paymentId

            // console.log("PaymentID", paymentId);

            const payment = await paymentCollection.findOne({ _id: new ObjectId(paymentId) })

            if (!payment) {
                throw new Error("Payment Not Found. You don't give payment request")
            }

            if (payment.status === "PAID") {
                return {
                    success: true,
                    message: "Payment already Paid"
                }
            }

            // console.log("Payment", payment);

            const data = {
                store_id: process.env.SSL_STORE_ID,
                store_passwd: process.env.SSL_STORE_PASS,
                total_amount: payment.amount,
                currency: "BDT",
                tran_id: payment.transactionId,
                success_url: `${process.env.SSL_SUCCESS_BACKEND_URL}?transactionId=${payment.transactionId}&amount=${payment.amount}&status=success`,
                fail_url: `${process.env.SSL_FAIL_BACKEND_URL}?transactionId=${payment.transactionId}&amount=${payment.amount}&status=fail`,
                cancel_url: `${process.env.SSL_CANCEL_BACKEND_URL}?transactionId=${payment.transactionId}&amount=${payment.amount}&status=cancel`,
                shipping_method: "N/A",
                product_name: "Medicine",
                product_category: "Service",
                product_profile: "general",
                cus_name: payment.name,
                cus_email: payment.email,
                cus_add2: "N/A",
                cus_city: "Dhaka",
                cus_state: "Dhaka",
                cus_postcode: "1000",
                cus_country: "Bangladesh",
                cus_fax: "01711111111",
                ship_name: "N/A",
                ship_add1: "N/A",
                ship_add2: "N/A",
                ship_city: "N/A",
                ship_state: "N/A",
                ship_postcode: 1000,
                ship_country: "N/A",
            }

            const response = await axios({
                method: "POST",
                url: process.env.SSL_PAYMENT_API,
                data: data,
                headers: { "Content-Type": "application/x-www-form-urlencoded" }
            })

            // console.log("Response", response.data);

            return res.json({
                success: true,
                message: "Get Gateway PageURL",
                paymentLink: response.data.GatewayPageURL
            })

        })

    } catch (error) {
        console.error("❌ MongoDB Connection Error:", error);
    }
}
run().catch(console.dir);

// Root route
app.get('/', (req, res) => {
    res.json({ message: "🚀 Yoo Server is running well!!" });
});

module.exports = app;


