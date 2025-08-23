require('dotenv').config();
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

const nodemailer = require('nodemailer')
const multer = require("multer");
const axios = require("axios");
const fs = require("fs");
const FormData = require("form-data");
const e = require('express');

const app = express()
app.use(express.json())
app.use(morgan('dev'))
app.use(cors({
    origin: [
        'http://localhost:3000',
        'https://healthq.vercel.app'
    ],
    credentials: true
}))

app.use(cors())
app.use(cookieParser());
//console.log(process.env.GOOGLE_Client_ID);
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

// 📂 Multer Setup (File Upload)
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, "uploads/");
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
                    const { password,userType, ...user } = req.body;
                    
                    const existingUser = await usersCollection.findOne({ email: user?.email });
                    

                    
                    if (existingUser) {
                        return res.json({
                            status: false,
                            message: 'User already exists, use another email address',
                            data: result
                        });
                    }
                    if(userType==='doctor'){
                        const existingpeople=await usersCollection.find({userType:userType}).toArray()
                        
                        const doctorid=existingpeople.length+1;
                       
                        const hashedPass = await bcrypt.hash(password, 10)

                    const withRole = {
                        ...user, password: hashedPass,userType,
                    Doctor_ID:`D0000${doctorid}`, failedAttempts: 0, block: false
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
                        ...user, password: hashedPass,userType,
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
                    if (body.specialty) updateFields.specialty = body.specialty;
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
                // console.log("Update fields:", updateFields);
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
            //console.log(body);
            const result = await BookingCollection.insertOne(body)
            res.json({
                status: true,
                message: "Appointment Booked Successfully",
                data: result
            })
        })
        //get all doctors
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
                const query = { doctorId: user?._id.toString() };
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
            const redirectPath = state.redirect
            //console.log('State email:', email,state); 
            if (!code || !email) {
                return res.status(400).send('Invalid request');
            }
            console.log('Received code:', code);
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
        // app.post('/api/google/create-event', async (req, res) => {
        //     const { doctorEmail, patientEmail, date, time, summary } = req.body;

        //     // const doctorsCollection = client.db('HealthQ').collection('users');
        //     const doctor = await usersCollection.findOne({ email: doctorEmail });

        //     if (!doctor?.googleTokens) return res.status(400).send('Doctor not connected to Google');

        //     const oauth2Client = new google.auth.OAuth2(
        //         process.env.GOOGLE_Client_ID,
        //         process.env.GOOGLE_Client_Secret
        //     );
        //     oauth2Client.setCredentials(doctor.googleTokens);

        //     const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

        //     const event = {
        //         summary: summary || 'HealthQ Appointment',
        //         description: `Appointment with ${patientEmail}`,
        //         start: { dateTime: new Date(`${date}T${time}`), timeZone: 'Asia/Dhaka' },
        //         end: { dateTime: new Date(`${date}T${time}` + 30 * 60 * 1000), timeZone: 'Asia/Dhaka' },
        //         attendees: [{ email: patientEmail }],
        //         conferenceData: { createRequest: { requestId: `meet-${Date.now()}` } }
        //     };

        //     try {
        //         const response = await calendar.events.insert({
        //             calendarId: 'primary',
        //             resource: event,
        //             conferenceDataVersion: 1
        //         });

        //         res.json({ status: true, meetLink: response.data.hangoutLink, eventId: response.data.id });
        //     } catch (error) {
        //         console.error(error);
        //         res.status(500).json({ status: false, message: 'Failed to create event', error: error.message });
        //     }
        // });

        // predict melanoma percentage 
        app.post('/api/google/create-event', async (req, res) => {
            try {
                const { doctorEmail, patientEmail, date, startTime,endTime, summary } = req.body;
                    if (!doctorEmail || !patientEmail || !date || !startTime || !endTime) {
      return res.status(400).json({ status: false, message: 'Missing required fields' });
    }
    console.log(startTime,endTime)
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
                    time:startTime,
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


