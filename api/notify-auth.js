import https from "https";

const nodeFetch = (url, options = {}) => {
    return new Promise((resolve, reject) => {
        const reqOptions = {
            method: options.method || 'GET',
            headers: options.headers || {}
        };
        if (options.body) {
            reqOptions.headers['Content-Type'] = 'application/json';
            reqOptions.headers['Content-Length'] = Buffer.byteLength(options.body);
        }
        
        const req = https.request(url, reqOptions, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                resolve({ ok: res.statusCode >= 200 && res.statusCode < 300 });
            });
        });
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
};

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { eventType, details } = req.body;
        const botToken = process.env.TELEGRAM_ORDERS_BOT;
        const chatId = process.env.TELEGRAM_ORDERS_CHAT_ID;

        if (!botToken || !chatId) {
            return res.status(500).json({ error: 'Telegram Auth Config is missing' });
        }

        let msg = '';
        if (eventType === 'SIGNUP') {
            msg = `🆕 <b>NEW REGISTERED DEVOTEE</b>\n` +
                  `<b>Name:</b> ${details.name}\n` +
                  `<b>Email:</b> ${details.email}\n` +
                  `<b>Phone:</b> ${details.phone}\n` +
                  `<b>Address:</b> ${details.address}`;
        } else if (eventType === 'LOGIN') {
            msg = `👤 <b>USER LOGGED IN</b>\n` +
                  `<b>Name:</b> ${details.name}\n` +
                  `<b>Email:</b> ${details.email}`;
        } else if (eventType === 'PROFILE_UPDATE') {
            msg = `🔄 <b>PROFILE UPDATED</b>\n` +
                  `<b>UID:</b> ${details.uid}\n` +
                  `<b>Name:</b> ${details.name}\n` +
                  `<b>Phone:</b> ${details.phone}\n` +
                  `<b>Address:</b> ${details.address}`;
        } else if (eventType === 'LOGOUT') {
            msg = `🚪 <b>USER LOGGED OUT</b>\n` +
                  `<b>Name:</b> ${details.name}\n` +
                  `<b>Email:</b> ${details.email}`;
        } else {
            return res.status(400).json({ error: 'Unknown event type' });
        }

        await nodeFetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            body: JSON.stringify({
                chat_id: chatId,
                text: msg,
                parse_mode: 'HTML'
            })
        });

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error("Auth notify error:", error);
        return res.status(500).json({ error: error.message });
    }
}
