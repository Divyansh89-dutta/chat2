const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const session = require("express-session");
const bcrypt = require("bcrypt");
const multer = require("multer");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// MongoDB Connection
mongoose.connect("mongodb://127.0.0.1:27017/chatApp", { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log("MongoDB Connected"))
    .catch((err) => console.error("MongoDB Connection Error:", err));

// Define User Schema
const UserSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    profilePicture: { type: String, default: "default.png" },
});
const User = mongoose.model("User", UserSchema);

// Define Chat Message Schema
const MessageSchema = new mongoose.Schema({
    username: String,
    message: String,
    timestamp: { type: Date, default: Date.now },
});
const Message = mongoose.model("Message", MessageSchema);

// Middleware
app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
    secret: "supersecretkey",
    resave: false,
    saveUninitialized: false,
}));
app.use("/uploads", express.static(path.join(__dirname, "uploads"))); // Serve uploaded files

// Multer Setup for Profile Pictures
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, "uploads"),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage });

// Routes
app.get("/", (req, res) => {
    if (req.session.username) {
        res.redirect("/chat");
    } else {
        res.sendFile(__dirname + "/public/login.html");
    }
});

app.get("/register", (req, res) => {
    res.sendFile(__dirname + "/public/register.html");
});

app.post("/register", async (req, res) => {
    const { username, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    try {
        await User.create({ username, password: hashedPassword });
        req.session.username = username; // Automatically log in the user
        req.session.profilePicture = "default.png"; // Default profile picture
        res.redirect("/profile"); // Redirect to profile page
    } catch (err) {
        res.send("Error: Username already exists.");
    }
});

app.post("/login", async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (user && (await bcrypt.compare(password, user.password))) {
        req.session.username = username;
        req.session.profilePicture = user.profilePicture;
        res.redirect("/chat");
    } else {
        res.send("Invalid username or password.");
    }
});

app.get("/chat", (req, res) => {
    if (!req.session.username) {
        res.redirect("/");
    } else {
        res.sendFile(__dirname + "/public/chat.html");
    }
});

app.get("/profile", (req, res) => {
    if (!req.session.username) {
        res.redirect("/");
    } else {
        res.sendFile(__dirname + "/public/profile.html");
    }
});

app.post("/profile", upload.single("profilePicture"), async (req, res) => {
    const username = req.session.username;
    const newProfilePicture = req.file ? req.file.filename : req.session.profilePicture;

    await User.updateOne({ username }, { profilePicture: newProfilePicture });
    req.session.profilePicture = newProfilePicture;
    res.redirect("/chat"); // Redirect to chat after saving profile
});

app.get("/logout", (req, res) => {
    req.session.destroy();
    res.redirect("/");
});

// Socket.IO Logic
io.on("connection", (socket) => {
    console.log("A user connected:", socket.id);

    // Load previous messages
    Message.find().sort({ timestamp: 1 }).then(async (messages) => {
        const messagesWithPictures = await Promise.all(
            messages.map(async (msg) => {
                const user = await User.findOne({ username: msg.username });
                return {
                    username: msg.username,
                    message: msg.message,
                    timestamp: msg.timestamp.toLocaleString(),
                    profilePicture: user ? `/uploads/${user.profilePicture}` : "/uploads/default.png",
                };
            })
        );
        socket.emit("load messages", messagesWithPictures);
    });

    socket.on("chat message", async (data) => {
        const { username, message } = data;

        // Fetch user's profile picture
        const user = await User.findOne({ username });
        const profilePicture = user ? `/uploads/${user.profilePicture}` : "/uploads/default.png";

        const timestamp = new Date();
        const newMessage = new Message({ username, message, timestamp });
        await newMessage.save();

        io.emit("chat message", {
            username,
            message,
            timestamp: timestamp.toLocaleString(),
            profilePicture,
        });
    });

    socket.on("disconnect", () => {
        console.log("A user disconnected:", socket.id);
    });
});

const PORT = 3001;
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
