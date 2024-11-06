const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");
const multer = require("multer");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = "public/uploads";
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + "-" + file.originalname);
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});

const users = {};
const chats = {};
const groups = {};
const online={}
// Add route for file uploads
app.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({
    url: fileUrl,
    filename: req.file.originalname,
    type: req.file.mimetype,
  });
});

io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Handle user registration
  socket.on("register", (username) => {
    // Add the user to the users object
    users[socket.id] = { username, id: socket.id, chats: [] };
    
    // Mark the user as online
    online[socket.id] = username;

    // Emit to the new user that they are successfully registered
    socket.emit("registered", { id: socket.id, username });
    
    // Notify all other connected users that a new user is online
    socket.broadcast.emit("user-online", { username });

    // Update the online user list for everyone
    io.emit("update-user-list", Object.values(users));
  });

  // Create or get one-on-one chat
  socket.on("create-chat", ({ recipientId }) => {
    const senderId = socket.id;

    // Check if chat already exists between these users
    const existingChat = Object.entries(chats).find(
      ([_, chat]) =>
        chat.participants.includes(senderId) &&
        chat.participants.includes(recipientId)
    );

    if (existingChat) {
      socket.emit("chat-created", {
        chatId: existingChat[0],
        participants: existingChat[1].participants.map(
          (id) => users[id].username
        ),
      });
    } else {
      const chatId = uuidv4();
      chats[chatId] = {
        type: "private",
        participants: [senderId, recipientId],
        messages: [],
      };

      users[senderId].chats.push(chatId);
      users[recipientId].chats.push(chatId);

      [senderId, recipientId].forEach((id) => {
        const userSocket = io.sockets.sockets.get(id);
        if (userSocket) {
          userSocket.emit("chat-created", {
            chatId,
            participants: chats[chatId].participants.map(
              (id) => users[id].username
            ),
          });
        }
      });
    }
  });

  // Handle typing event
  socket.on("typing", ({ chatId }) => {
    const user = users[socket.id];
    if (!user) return;

    const chat = chats[chatId] || groups[chatId];
    if (!chat) return;

    const recipients = chat.type === "private" ? chat.participants : chat.members;
    
    recipients.forEach((recipientId) => {
      if (recipientId !== socket.id) {
        const recipientSocket = io.sockets.sockets.get(recipientId);
        if (recipientSocket) {
          recipientSocket.emit("user-typing", {
            chatId,
            username: user.username
          });
        }
      }
    });
  });


  // Create group chat
  socket.on("create-group", ({ groupName, memberIds }) => {
    const groupId = uuidv4();
    const allMembers = [...new Set([socket.id, ...memberIds])];

    groups[groupId] = {
      id: groupId,
      name: groupName,
      members: allMembers,
      messages: [],
      createdBy: socket.id,
    };

    allMembers.forEach((memberId) => {
      if (users[memberId]) {
        users[memberId].chats.push(groupId);
      }
    });

    allMembers.forEach((memberId) => {
      const memberSocket = io.sockets.sockets.get(memberId);
      if (memberSocket) {
        memberSocket.emit("group-created", {
          groupId,
          name: groupName,
          members: allMembers.map((id) => users[id].username),
        });
      }
    });
  });

  // Send message (works for both private and group chats)
  socket.on("send-message", ({ chatId, message, attachment }) => {
    const sender = users[socket.id];
    const chat = chats[chatId] || groups[chatId];

    if (!chat) return;

    const messageObj = {
      id: uuidv4(),
      sender: sender.username,
      content: message,
      timestamp: new Date(),
      attachment: attachment,
      // seen:false
    };

    chat.messages.push(messageObj);

    const recipients = chat.type === "private" ? chat.participants : chat.members;

    recipients.forEach((recipientId) => {
      const recipientSocket = io.sockets.sockets.get(recipientId);
      if (recipientSocket) {
        recipientSocket.emit("message", {
          chatId,
          message: messageObj,
        });
      }
    });
  });

    // Handle message seen status
  // socket.on("message-seen", ({ chatId, messageId }) => {
  //   const chat = chats[chatId];
  //   if (!chat) return;

  //   // Verify the user is a participant in the chat
  //   if (!chat.participants.includes(socket.id)) return;

  //   // Find and update the message
  //   const message = chat.messages.find(msg => msg.id === messageId);
  //   if (message) {
  //     message.seen = true;

  //     // Notify the sender that their message was seen
  //     const senderSocket = io.sockets.sockets.get(message.sender);
  //     if (senderSocket) {
  //       senderSocket.emit("message-status-update", {
  //         chatId,
  //         messageId,
  //         seen: true,
  //         seenBy: users[socket.id].username
  //       });
  //     }
  //   }
  // });

  // Get chat history
  socket.on("get-chat-history", ({ chatId }) => {
    const chat = chats[chatId] || groups[chatId];
    if (chat) {
      socket.emit("chat-history", {
        chatId,
        messages: chat.messages,
        participants:
          chat.type === "private"
            ? chat.participants.map((id) => users[id].username)
            : chat.members.map((id) => users[id].username),
      });
    }
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    const username = users[socket.id]?.username;
    if (username) {
      io.emit("user-disconnected", { username });
      delete users[socket.id];
      io.emit("update-user-list", Object.values(users));
    }
  });
});


app.use(express.static(path.resolve("./public")));

app.get("/", (req, res) => {
  return res.sendFile(path.join(__dirname, "/public/index.html"));
});

server.listen(3000, () => {
  console.log("Server started at 3000");
});
