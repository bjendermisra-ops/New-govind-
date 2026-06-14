import https from "https";

// कस्टम बुलेटप्रूफ़ रिक्वेस्ट हेल्पर (Node.js native HTTPs)
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
                resolve({
                    ok: res.statusCode >= 200 && res.statusCode < 300,
                    statusCode: res.statusCode,
                    json: async () => {
                        try {
                            return JSON.parse(body);
                        } catch (e) {
                            return { error: "Failed to parse JSON", raw: body };
                        }
                    }
                });
            });
        });
        
        req.on('error', reject);
        if (options.body) {
            req.write(options.body);
        }
        req.end();
    });
};

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { paymentMode, razorpay_payment_id, orderData } = req.body;

        const dbUrl = "https://iskcon-food-default-rtdb.firebaseio.com/orders.json";
        const botToken = process.env.TELEGRAM_ORDERS_BOT;
        const chatId = process.env.TELEGRAM_ORDERS_CHAT_ID;
        const rzpId = process.env.RAZORPAY_KEY_ID;
        const rzpSecret = process.env.RAZORPAY_KEY_SECRET;

        // 1. ऑनलाइन पेमेंट वेरिफिकेशन
        if (paymentMode === 'Online') {
            if (!razorpay_payment_id) {
                return res.status(400).json({ error: 'Missing Razorpay Payment ID' });
            }

            const authHeader = 'Basic ' + Buffer.from(rzpId + ':' + rzpSecret).toString('base64');
            const rzpRes = await nodeFetch(`https://api.razorpay.com/v1/payments/${razorpay_payment_id}`, {
                method: 'GET',
                headers: { 'Authorization': authHeader }
            });

            if (!rzpRes.ok) {
                await notifySecurityAlert("Invalid/Fake Payment ID used during transaction attempt", orderData);
                return res.status(400).json({ error: 'Fake Payment ID detected!' });
            }

            const rzpPayment = await rzpRes.json();
            const expectedPaise = Math.round(orderData.total * 100);

            const isValidStatus = rzpPayment.status === 'captured' || rzpPayment.status === 'authorized';
            const isValidAmount = Math.abs(rzpPayment.amount - expectedPaise) <= 1;

            if (!isValidStatus || !isValidAmount) {
                await notifySecurityAlert(`Cheat Attempt! Status: ${rzpPayment.status}, Amount: ₹${rzpPayment.amount/100}`, orderData);
                return res.status(400).json({ error: 'Verification failed. Tampering detected!' });
            }

            orderData.paymentId = razorpay_payment_id;
            orderData.status = 'placed';
        } else {
            orderData.status = 'placed';
        }

        orderData.createdAt = Date.now();

        // 2. फ़ायरबेस डेटाबेस में सुरक्षित एंट्री
        const firebaseRes = await nodeFetch(dbUrl, {
            method: 'POST',
            body: JSON.stringify(orderData)
        });

        if (!firebaseRes.ok) {
            throw new Error("Failed to write verified order to Firebase RTDB");
        }

        const firebaseData = await firebaseRes.json();
        const orderId = firebaseData.name;

        // 3. टेलीग्राम पर सफल ऑर्डर का संदेश भेजना
        if (botToken && chatId) {
            const itemSummary = orderData.items.map(i => `• ${i.name} (${i.qty} x ₹${i.price})`).join('\n');
            const payIdStr = orderData.paymentId ? `\n<b>Razorpay Pay ID:</b> ${orderData.paymentId}` : '';
            const msg = `🔔 <b>NEW ORDER PLACED!</b>\n` +
                        `<b>Order ID:</b> #${orderId.slice(-5).toUpperCase()} (${orderId})\n` +
                        `<b>Customer Name:</b> ${orderData.userName}\n` +
                        `<b>Phone:</b> ${orderData.userPhone}\n` +
                        `<b>Address:</b> ${orderData.address}\n` +
                        `<b>Payment Mode:</b> ${orderData.paymentMode}${payIdStr}\n\n` +
                        `📦 <b>Items:</b>\n${itemSummary}\n\n` +
                        `💰 <b>Bill Details:</b>\n` +
                        `Subtotal: ₹${orderData.subTotal}\n` +
                        `Discount: ₹${orderData.discount}\n` +
                        `Delivery Fee: ₹${orderData.deliveryFee}\n` +
                        `<b>Total Paid:</b> ₹${orderData.total}`;

            await nodeFetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: 'POST',
                body: JSON.stringify({
                    chat_id: chatId,
                    text: msg,
                    parse_mode: 'HTML'
                })
            });
        }

        return res.status(200).json({ success: true, orderId: orderId });

    } catch (error) {
        console.error("Order processing error:", error);
        return res.status(500).json({ error: error.message });
    }
}

async function notifySecurityAlert(reason, orderData) {
    const leadsBot = process.env.TELEGRAM_LEADS_BOT;
    const leadsChat = process.env.TELEGRAM_LEADS_CHAT_ID;
    if (!leadsBot || !leadsChat) return;

    const itemsStr = orderData.items.map(i => `• ${i.name} (${i.qty} x ₹${i.price})`).join('\n');
    const msg = `🚨 <b>TAMPER WARNING / SECURE CHECKOUT ALERT!</b>\n` +
                `<b>Reason:</b> ${reason}\n` +
                `<b>Customer Name:</b> ${orderData.userName}\n` +
                `<b>Phone:</b> <a href="tel:${orderData.userPhone}">${orderData.userPhone}</a>\n` +
                `<b>Cart Summary:</b>\n${itemsStr}\n` +
                `<b>Total expected amount:</b> ₹${orderData.total}`;

    await nodeFetch(`https://api.telegram.org/bot${leadsBot}/sendMessage`, {
        method: 'POST',
        body: JSON.stringify({
            chat_id: leadsChat,
            text: msg,
            parse_mode: 'HTML'
        })
    }).catch(e => console.error(e));
}
