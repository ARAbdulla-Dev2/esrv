const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || '3000';

// Static files middleware
app.use(express.static('public'));

// Paths to data files
const DATA_FILE = path.join(__dirname, 'data/data.json');
const IP_FILE = path.join(__dirname, 'data/ip.json');

// Load tokens from file
let tokens = {};
if (fs.existsSync(DATA_FILE)) {
    const data = fs.readFileSync(DATA_FILE);
    tokens = JSON.parse(data).tokens || {};
}

// Helper function to save tokens to data.json
function saveTokens() {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ tokens }, null, 2));
}

// Helper function to generate a token
function generateToken() {
    return crypto.randomBytes(16).toString('hex');
}

// Middleware to validate token
function validateToken(req, res, next) {
    const token = req.query.token;
    const now = Date.now();
    if (token && tokens[token] && tokens[token] > now) {
        return next();
    }
    return res.status(403).send('Access Denied: Invalid or Expired Token');
}

function logAndRestrictService(req, res, next) {
    const clientIp = req.headers['x-forwarded-for'] || req.ip || req.connection.remoteAddress;
    const normalizedIp = clientIp === '::1' ? '127.0.0.1' : clientIp;
    const product = req.path.split('/').pop(); // Use the last part of the path as the product
    const now = Date.now();

    // Load existing IP data
    let ipData = {};
    if (fs.existsSync(IP_FILE)) {
        try {
            const ipFileContent = fs.readFileSync(IP_FILE, 'utf8');
            ipData = JSON.parse(ipFileContent);
        } catch (error) {
            console.error('Error reading or parsing IP file:', error);
        }
    }

    // Initialize the client's record if not present
    if (!ipData[normalizedIp]) {
        ipData[normalizedIp] = {};
    }

    // Check if the client is restricted from using this product
    if (ipData[normalizedIp][product] && ipData[normalizedIp][product] > now) {
        const remainingTime = Math.ceil((ipData[normalizedIp][product] - now) / (1000 * 60 * 60 * 24));
        return res.status(403).send(`Access Denied: You can use this product again in ${remainingTime} days.`);
    }

    // Log the product usage and restrict for 3 days
    ipData[normalizedIp][product] = now + 3 * 24 * 60 * 60 * 1000;
    try {
        fs.writeFileSync(IP_FILE, JSON.stringify(ipData, null, 2));
    } catch (error) {
        console.error('Error writing to IP file:', error);
    }

    console.log(`IP ${normalizedIp} accessed product: ${product}`);
    next();
}



// API to generate a token
app.get('/api/genToken', (req, res) => {
    const token = generateToken();
    const expiryTime = Date.now() + 15 * 60 * 1000; // 15 minutes
    tokens[token] = expiryTime;
    saveTokens();
    res.json({ token, expiresIn: '15 minutes' });
});

// Path to free VPS file
const FREE_VPS_FILE = path.join(__dirname, 'data/free-vps.txt');

// Helper function to get and remove a random VPS
function getRandomVPS() {
    const data = fs.readFileSync(FREE_VPS_FILE, 'utf8');
    const vpsList = data.trim().split('\n');

    if (vpsList.length === 0) {
        return null;
    }

    // Select a random VPS
    const randomIndex = Math.floor(Math.random() * vpsList.length);
    const selectedVPS = vpsList[randomIndex];

    // Remove the selected VPS from the list
    vpsList.splice(randomIndex, 1);
    fs.writeFileSync(FREE_VPS_FILE, vpsList.join('\n'));

    return selectedVPS;
}

// API to get a free VPS
app.get('/api/free-vps', (req, res) => {
    const vps = getRandomVPS();

    if (vps) {
        const [url, password] = vps.split(';');
        res.json({ success: true, url, password });
    } else {
        res.json({
            success: false,
            message: 'All free VPS are out of stock. Please try again tomorrow.'
        });
    }
});

// Set up /affl routes with restrictions
app.use('/affl', validateToken, logAndRestrictService, (req, res) => {
    //res.send(`You have successfully accessed the service: ${req.path}`);
    res.sendFile(path.join(__dirname, `pages/affl/${req.path}.html`))
});

// Recursive function to set up routes for all HTML files in a directory
function setupRoutes(directory, baseRoute = '') {
    fs.readdir(directory, { withFileTypes: true }, (err, entries) => {
        if (err) {
            console.error(`Error reading directory ${directory}:`, err);
            return;
        }

        entries.forEach((entry) => {
            const fullPath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                const folderRoute = `${baseRoute}/${entry.name}`;
                setupRoutes(fullPath, folderRoute);
            } else if (entry.isFile() && path.extname(entry.name) === '.html') {
                const fileRoute =
                    entry.name === 'index.html'
                        ? baseRoute || '/'
                        : `${baseRoute}/${path.basename(entry.name, '.html')}`;

                app.get(fileRoute, (req, res) => {
                    res.sendFile(fullPath);
                });

                console.log(`Route ${fileRoute} is now serving ${fullPath}`);
            }
        });
    });
}

// Set up routes for the `pages` directory
const pagesDir = path.join(__dirname, 'pages');
setupRoutes(pagesDir);

// Periodic cleanup for expired tokens
setInterval(() => {
    const now = Date.now();
    Object.keys(tokens).forEach((token) => {
        if (tokens[token] <= now) {
            delete tokens[token];
        }
    });
    saveTokens();
}, 60 * 1000); // Cleanup every minute

// Start server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
