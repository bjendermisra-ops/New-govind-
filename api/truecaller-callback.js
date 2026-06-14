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
                resolve({
                    ok: res.statusCode >= 200 && res.statusCode < 300,
                    statusCode: res.statusCode,
                    json: async () => JSON.parse(body)
                });
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
        const { requestId, accessToken, endpoint } = req.body;

        if (!accessToken || !requestId) {
            return res.status(400).json({ error: 'Missing token or requestId' });
        }

        // 1. ट्रूकॉलर एक्सेस टोकन का उपयोग करके ग्राहक की प्रोफाइल फेच करना
        const profileUrl = endpoint || "https://profile4-noneu.truecaller.com/v1/default";
        const rRes = await nodeFetch(profileUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });

        if (!rRes.ok) {
            return res.status(400).json({ error: 'Failed to fetch profile' });
        }

        const profile = await rRes.json();

        // नाम और मोबाइल नंबर निकालना
        const name = `${profile.name?.first || ''} ${profile.name?.last || ''}`.trim() || "Truecaller User";
        const phone = profile.phoneNumbers?.[0] || "";

        // 2. रियल-टाइम सिंक के लिए अस्थायी डेटा फ़ायरबेस में सेव करना
        const dbSessionUrl = `https://iskcon-food-default-rtdb.firebaseio.com/truecaller_sessions/${encodeURIComponent(requestId)}.json`;
        await nodeFetch(dbSessionUrl, {
            method: 'PUT',
            body: JSON.stringify({
                name: name,
                phone: phone,
                email: profile.onlineAddresses?.[0] || `${phone}@truecaller.com`,
                status: 'success',
                timestamp: Date.now()
            })
        });

        return res.status(200).json({ success: true });
    } catch (e) {
        console.error("Truecaller callback error:", e);
        return res.status(500).json({ error: e.message });
    }
}
