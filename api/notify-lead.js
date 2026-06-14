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
        const { reason, orderData } = req.body;
        const botToken = process.env.TELEGRAM_LEADS_BOT;
        const chatId = process.env.TELEGRAM_LEADS_CHAT_ID;

        if (!botToken || !chatId) {
            return res.status(500).json({ error: 'Telegram Leads Config is missing' });
        }

        const itemsStr = orderData.items.map(i => `• ${i.name} (${i.qty} x ₹${i.price})`).join('\n');
        
        const msg = `⚠️ <b>PAYMENT FAILED / INCOMPLETE CHECKOUT LEAD!</b>\n` +
                    `<b>Reason:</b> ${reason}\n` +
                    `<b>Customer Name:</b> ${orderData.userName}\n` +
                    `<b>Phone:</b> <a href="tel:${orderData.userPhone}">${orderData.userPhone}</a>\n` +
                    `<b>Address:</b> ${orderData.address}\n\n` +
                    `🛒 <b>Cart Items:</b>\n${itemsStr}\n\n` +
                    `💰 <b>Expected Calculation:</b>\n` +
                    `Subtotal: ₹${orderData.subTotal}\n` +
                    `Discount Off: ₹${orderData.discount}\n` +
                    `Delivery Fee: ₹${orderData.deliveryFee}\n` +
                    `<b>Expected Payable:</b> ₹${orderData.total}\n\n` +
                    `📞 <i>Please contact the devotee to assist them in completing the order!</i>`;

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
        console.error("Leads notification error:", error);
        return res.status(500).json({ error: error.message });
    }
}
