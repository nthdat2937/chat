const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const fileUpload = require('express-fileupload');
const path = require('path');
const fs = require('fs');
const ADMIN_USERNAME = 'nthdat2937';

const ADMIN_CONFIG = [
    {
        username: 'nthdat2937',
        password: 'admin123'
    },
    {
        username: 'admin2',
        password: 'admin456'
    },
    {
        username: 'superadmin',
        password: 'super123'
    }
];

const BOT_CONFIG = {
    username: 'Bot',
    password: 'bottest'
};

function isBot(username, password) {
    return username === BOT_CONFIG.username && password === BOT_CONFIG.password;
}

function isValidAdmin(username, password) {
    if (isBot(username, password)) return false;
    return ADMIN_CONFIG.some(admin => 
        admin.username === username && 
        admin.password === password
    );
}

function formatTimeUTC7(date) {
    return new Date(date.getTime() + 7 * 60 * 60 * 1000)
        .toISOString()
        .replace('T', ' ')
        .slice(0, 19);
}

app.use(express.static('public'));
app.use(express.json());
app.use(fileUpload({
    createParentPath: true,
    limits: { 
        fileSize: 20 * 1024 * 1024
    },
    abortOnLimit: true,
    uploadTimeout: 30000,
    useTempFiles: true,
    tempFileDir: '/tmp/',
    debug: false,
    safeFileNames: false,
    preserveExtension: 4
}));

const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir, { recursive: true });
}

setInterval(() => {
    const files = fs.readdirSync(uploadDir);
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;

    files.forEach(file => {
        const filePath = path.join(uploadDir, file);
        const stats = fs.statSync(filePath);
        if (now - stats.mtime.getTime() > oneDay) {
            fs.unlinkSync(filePath);
        }
    });
}, 24 * 60 * 60 * 1000);

const onlineUsers = new Map();
const authenticatedAdmins = new Set();

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

app.get('/chat.html', (req, res) => {
    res.sendFile(__dirname + '/public/chat.html');
});

app.post('/verify-admin', (req, res) => {
    const { username, password } = req.body;
    
    if (username === BOT_CONFIG.username) {
        if (password === BOT_CONFIG.password) {
            res.json({ 
                status: 'success', 
                isBot: true
            });
        } else {
            res.status(401).json({
                status: 'error',
                message: 'Invalid Bot credentials'
            });
        }
        return;
    }
    
    if (isValidAdmin(username, password)) {
        const sessionToken = Math.random().toString(36).substring(2) + Date.now().toString(36);
        authenticatedAdmins.add({
            token: sessionToken,
            username: username,
            createdAt: Date.now()
        });
        
        setTimeout(() => {
            authenticatedAdmins.delete(sessionToken);
        }, 24 * 60 * 60 * 1000);
        
        res.json({ status: 'success', sessionToken });
    } else {
        res.status(401).json({ 
            status: 'error', 
            message: 'Invalid admin credentials' 
        });
    }
});

app.post('/upload', async (req, res) => {
    try {
        if (!req.files || !req.files.file) {
            return res.status(400).json({ 
                status: 'error', 
                message: 'No file uploaded' 
            });
        }

        const file = req.files.file;
        const now = new Date();
        const timestamp = now.getTime();
        
        const originalExt = path.extname(file.name);
        const cleanExt = originalExt.toLowerCase();
        const safeName = `${timestamp}${cleanExt}`;
        
        const allowedTypes = [
            'image/jpeg', 'image/png', 'image/gif', 'image/webp',
            'application/pdf', 
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel', 
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'text/plain', 'application/zip', 'application/x-rar-compressed',
            'audio/mpeg', 'video/mp4'
        ];

        if (!allowedTypes.includes(file.mimetype)) {
            return res.status(400).json({
                status: 'error',
                message: 'File type not allowed'
            });
        }

        const uploadPath = path.join(uploadDir, safeName);
        await file.mv(uploadPath);

        res.json({
            status: 'success',
            path: '/uploads/' + safeName,
            filename: file.name,
            uploadTime: formatTimeUTC7(new Date())
        });

    } catch (err) {
        console.error('Upload error:', err);
        res.status(500).json({
            status: 'error',
            message: 'Error uploading file'
        });
    }
});

io.on('connection', (socket) => {
    let currentUser = null;
    let isAdmin = false;
    let isBot = false;
    let adminSessionToken = null;

    socket.on('join chat', (data) => {
        currentUser = data.username;
        socket.username = data.username;
        
        if (currentUser === BOT_CONFIG.username) {
            isAdmin = false;
            isBot = true;
            console.log(`Trợ lý ${currentUser} đã kết nối`);
        } else {
            const adminData = Array.from(authenticatedAdmins).find(a => 
                a.token === data.sessionToken && 
                a.username === data.username
            );

            if (adminData) {
                isAdmin = true;
                isBot = false;
                adminSessionToken = adminData.token;
                console.log(`Admin ${currentUser} đã xác thực thành công`);
            } else {
                isAdmin = false;
                isBot = false;
                adminSessionToken = null;
            }
        }

        onlineUsers.set(currentUser, {
            socketId: socket.id,
            loginTime: data.loginTime,
            isAdmin,
            isBot: currentUser === BOT_CONFIG.username
        });

        io.emit('online users', Array.from(onlineUsers));
        
        socket.broadcast.emit('user joined', {
            username: currentUser,
            time: formatTimeUTC7(new Date())
        });

        console.log(`Người dùng ${currentUser} tham gia cuộc trò chuyện${isAdmin ? ' với vai trò Admin' : ''}`);
    });

    socket.on('kick user', (data) => {
        const { userToKick, adminToken, reason } = data;
        
        const adminData = Array.from(authenticatedAdmins).find(a => a.token === adminToken);
        if (!adminData || onlineUsers.get(currentUser)?.isBot) {
            console.log('Unauthorized kick attempt by:', currentUser);
            socket.emit('kick error', { message: 'Bạn không có quyền kick người dùng!' });
            return;
        }

        const kickedUserData = onlineUsers.get(userToKick);
        const isKickedUserAdmin = ADMIN_CONFIG.some(admin => admin.username === userToKick);
        
        if (kickedUserData && !isKickedUserAdmin) {
            const kickData = {
                byUser: currentUser,
                time: formatTimeUTC7(new Date()),
                reason: reason
            };

            io.to(kickedUserData.socketId).emit('kicked', kickData);

            io.emit('user kicked', {
                username: userToKick,
                byUser: currentUser,
                time: formatTimeUTC7(new Date()),
                reason: reason
            });

            onlineUsers.delete(userToKick);

            const kickedSocket = io.sockets.sockets.get(kickedUserData.socketId);
            if (kickedSocket) {
                kickedSocket.disconnect(true);
            }

            io.emit('online users', Array.from(onlineUsers));
            
            console.log(`Người dùng ${userToKick} đã bị kick bởi admin ${currentUser}. Reason: ${reason || 'No reason provided'}`);
        } else {
            console.log(`Không thể kick người dùng ${userToKick} (bạn không phải admin)`);
            socket.emit('kick error', { 
                message: isKickedUserAdmin ? 
                    'Không thể kick tài khoản admin khác!' : 
                    'Không tìm thấy người dùng này!'
            });
        }
    });
  
    socket.on('chat message', (msg) => {
        if (!msg.trim()) return;

        io.emit('chat message', {
            username: currentUser,
            text: msg,
            time: formatTimeUTC7(new Date())
        });
    });

    socket.on('file message', (fileData) => {
        io.emit('file message', {
            username: currentUser,
            file: fileData,
            time: formatTimeUTC7(new Date())
        });
    });

    socket.on('typing', () => {
        socket.broadcast.emit('user typing', { username: currentUser });
    });

    socket.on('stop typing', () => {
        socket.broadcast.emit('user stop typing');
    });

    socket.on('private message', (data) => {
        const targetSocket = Array.from(io.sockets.sockets.values())
            .find(s => s.username === data.to);
        
        if (targetSocket) {
            targetSocket.emit('private message', {
                from: socket.username,
                to: data.to,
                message: data.message,
                time: data.time || new Date().toLocaleTimeString()
            });
        }
    });

    socket.on('disconnect', () => {
        if (currentUser) {
            if (adminSessionToken) {
                authenticatedAdmins.delete(adminSessionToken);
            }
            onlineUsers.delete(currentUser);
            io.emit('online users', Array.from(onlineUsers));
            io.emit('user left', {
                username: currentUser,
                time: formatTimeUTC7(new Date())
            });
        }
    });
});

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        status: 'error',
        message: 'Something broke!'
    });
});

io.use((socket, next) => {
    const time = new Date().toISOString().replace('T', ' ').slice(0, 19);
    console.log(`[${time}] Cố gắng kết nối mới`);
    next();
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Máy chủ đang chạy ở cổng ${PORT}`);
    console.log('Thời gian hiện tại (Hanoi):', formatTimeUTC7(new Date()));
});

process.on('SIGTERM', () => {
    http.close(() => {
        console.log('Máy chủ đang đóng...');
        process.exit(0);
    });
});

setInterval(() => {
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    
    authenticatedAdmins.forEach(admin => {
        if (now - admin.createdAt > oneDay) {
            authenticatedAdmins.delete(admin);
        }
    });
}, 60 * 60 * 1000);