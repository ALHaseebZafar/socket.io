
const socket = io();
let currentUser = null;
let currentChat = null;
let selectedUsers = new Set();
let currentFile = null;

// DOM Elements
const registerModal = document.getElementById("registration");
const mainInterface = document.getElementById("mainInterface");
const createGroupModal = document.getElementById("createGroupModal");
const messageInput = document.getElementById("messageInput");
const messages = document.getElementById("messages");
const seen=document.getElementById("seen")
const usersList = document.getElementById("usersList");
const chatsList = document.getElementById("chatsList");
const chatMembers = document.getElementById("chatMembers");
const currentChatName = document.getElementById("currentChatName");
const uploadPreview = document.getElementById("uploadPreview");
const chatInput = document.getElementById("chatInput");

let typingTimer = null;

// Add this after other DOM elements
const typingStatus = document.getElementById('typingStatus');

// Add typing event listener
messageInput.addEventListener('input', () => {
  if (currentChat) {
    clearTimeout(typingTimer);
    socket.emit('typing', { chatId: currentChat });
    

  }
});

// Add this with your other socket event listeners
socket.on('user-typing', ({ chatId, username }) => {
  console.log('Typing event received:', username); // Debug log
  if (currentChat === chatId && username !== currentUser?.username) {
    typingStatus.textContent = `${username} is typing...`;
    
    // Clear typing status after 2 seconds
 
  }
});

// Update your sendMessage function to clear typing status
function sendMessage() {
  const message = messageInput.value.trim();
  if ((message || currentFile) && currentChat) {
    socket.emit('send-message', {
      chatId: currentChat,
      message,
      attachment: currentFile,
    });
    messageInput.value = '';
    currentFile = null;
    document.getElementById('fileInput').value = '';
    document.getElementById('uploadPreview').textContent = '';
    typingStatus.textContent = ''; // Clear typing status when message is sent
    seen:true;
  }
}



// Register User
document.getElementById("registerBtn").addEventListener("click", () => {
  const username = document.getElementById("username").value;
  if (username.trim()) {
    socket.emit("register", username);
  }
});

// File Upload Handling
document.getElementById("attachButton").addEventListener("click", () => {
  document.getElementById("fileInput").click();
});

document.getElementById("fileInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      // 5MB limit
      alert("File size must be less than 5MB");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);

    // Continuing from where we left off in the script section:

    uploadPreview.textContent = `Uploading: ${file.name}`;

    try {
      const response = await fetch("/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Upload failed");
      }

      const data = await response.json();
      currentFile = data;
      uploadPreview.textContent = `Ready to send: ${file.name}`;
    } catch (error) {
      console.error("Error uploading file:", error);
      alert("Failed to upload file");
      uploadPreview.textContent = "";
    }
  });

// Create Group Chat
document.getElementById("createGroupBtn").addEventListener("click", () => {
    createGroupModal.style.display = "block";
    updateGroupUsersList();
  });

document.getElementById("confirmGroupBtn").addEventListener("click", () => {
    const groupName = document.getElementById("groupName").value;
    if (groupName.trim() && selectedUsers.size > 0) {
      socket.emit("create-group", {
        groupName,
        memberIds: Array.from(selectedUsers),
      });
      createGroupModal.style.display = "none";
      selectedUsers.clear();
      document.getElementById("groupName").value = "";
    }
  });

document.getElementById("cancelGroupBtn").addEventListener("click", () => {
    createGroupModal.style.display = "none";
    selectedUsers.clear();
    document.getElementById("groupName").value = "";
  });

// Send Message
document.getElementById("sendBtn").addEventListener("click", sendMessage);
messageInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    sendMessage();
  }
});

// function sendMessage() {
//   const message = messageInput.value.trim();
//   if ((message || currentFile) && currentChat) {
//     socket.emit("send-message", {
//       chatId: currentChat,
//       message,
//       attachment: currentFile,
//     });
//     messageInput.value = "";
//     currentFile = null;
//     document.getElementById("fileInput").value = "";
//     uploadPreview.textContent = "";
//   }
// }

// Socket Events
socket.on("registered", ({ id, username }) => {
  currentUser = { id, username };
  registerModal.style.display = "none";
  mainInterface.style.display = "grid";
});

socket.on("update-user-list", (users) => {
  updateUsersList(users);
});

socket.on("chat-created", ({ chatId, participants }) => {
  const chatName = participants
    .filter((name) => name !== currentUser.username)
    .join(", ");
  addChatToList(chatId, chatName);
});

socket.on("group-created", ({ groupId, name, members }) => {
  addChatToList(groupId, name, true);
});

socket.on("message", ({ chatId, message }) => {
  if (currentChat === chatId) {
    displayMessage(message);
  }
});

socket.on("chat-history", ({ chatId, messages, participants }) => {
  displayChatHistory(messages);
  displayChatMembers(participants);
});

// Helper Functions
function updateUsersList(users) {
  usersList.innerHTML = "";
  users.forEach((user) => {
    if (user.id !== currentUser?.id) {
      const div = document.createElement("div");
      div.className = "user-item";
      div.textContent = user.username;
      div.dataset.userId = user.id;
      div.onclick = () => {
        socket.emit("create-chat", { recipientId: user.id });
      };
      usersList.appendChild(div);
    }
  });
}

function updateGroupUsersList() {
  const groupUsersList = document.getElementById("groupUsersList");
  groupUsersList.innerHTML = "";
  Array.from(usersList.children).forEach((userItem) => {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = userItem.dataset.userId;
    checkbox.onchange = (e) => {
      if (e.target.checked) {
        selectedUsers.add(e.target.value);
      } else {
        selectedUsers.delete(e.target.value);
      }
    };
    const label = document.createElement("label");
    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(userItem.textContent));
    groupUsersList.appendChild(label);
  });
}

function addChatToList(chatId, name, isGroup = false) {
  const existingChat = Array.from(chatsList.children).find(
    (chat) => chat.dataset.chatId === chatId
  );

  if (!existingChat) {
    const div = document.createElement("div");
    div.className = "chat-item";
    div.dataset.chatId = chatId;
    div.textContent = isGroup ? `👥 ${name}` : `👤 ${name}`;
    div.onclick = () => {
      currentChat = chatId;
      currentChatName.textContent = name;
      socket.emit("get-chat-history", { chatId });

      document.querySelectorAll(".chat-item").forEach((item) => {
        item.classList.remove("active");
      });
      div.classList.add("active");
    };
    chatsList.appendChild(div);
  }
}


function displayMessage(message) {

  const messageDiv = document.createElement("div");
  messageDiv.className = `message ${
    message.sender === currentUser.username ? "sent" : "received"
  }`;

  const content = document.createElement("div");
  content.textContent = message.content;
  messageDiv.appendChild(content);

  // Add attachment if present
  if (message.attachment) {
    const attachmentDiv = document.createElement("div");
    attachmentDiv.className = "attachment";

    if (message.attachment.type.startsWith("image/")) {
      // Image preview
      const img = document.createElement("img");
      img.src = message.attachment.url;
      img.alt = message.attachment.filename;
      attachmentDiv.appendChild(img);
    }

    // Download link
    const link = document.createElement("a");
    link.href = message.attachment.url;
    link.download = message.attachment.filename;
    link.innerHTML = `📎 ${message.attachment.filename}`;
    attachmentDiv.appendChild(link);

    messageDiv.appendChild(attachmentDiv);
  }

  const timestamp = document.createElement("div");
  timestamp.className = "timestamp";
  timestamp.textContent = new Date(
    message.timestamp
  ).toLocaleTimeString();
  messageDiv.appendChild(timestamp);

  messages.appendChild(messageDiv);
  messages.scrollTop = messages.scrollHeight;
  
}

function displayChatHistory(messageHistory) {
  messages.innerHTML = "";
  messageHistory.forEach((message) => {
    displayMessage(message);
  });
}

function displayChatMembers(participants) {
  chatMembers.textContent = `Members: ${participants.join(", ")}`;
}
