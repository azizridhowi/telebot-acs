const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

class GenieACSBot {
    constructor(config) {
        console.log(`[${Date.now()}] Initializing bot for ${config.name}...`);
        this.config = config;
        this.name = config.name;
        
        // Load customers from isolated data file
        this.loadCustomers();
        this.userSessions = {};

        // Validasi konfigurasi
        if (!this.validateConfig()) {
            console.error(`[${Date.now()}] Failed to validate config for ${this.name}`);
            return;
        }

        try {
            console.log(`[${Date.now()}] Creating bot instance for ${this.name}...`);
            this.bot = new TelegramBot(config.botToken, {
                polling: true,
                onlyFirstMatch: true,
                request: {
                    timeout: 30000
                }
            });

            // Test koneksi bot
            this.bot.getMe().then((botInfo) => {
                console.log(`[${Date.now()}] Bot connected successfully as @${botInfo.username}`);
                this.setupHandlers();
            }).catch((error) => {
                console.error(`[${Date.now()}] Failed to connect bot:`, error.message);
                this.bot = null;
            });

        } catch (error) {
            console.error(`[${Date.now()}] Error in constructor:`, error.message);
            this.bot = null;
        }
    }

    validateConfig() {
        if (!this.config.botToken) {
            console.error(`[${this.name}] Error: Bot token tidak ditemukan`);
            return false;
        }

        if (!/^\d+:[A-Za-z0-9_-]{35,}$/.test(this.config.botToken)) {
            console.error(`[${this.name}] Error: Format bot token tidak valid`);
            return false;
        }

        if (!Array.isArray(this.config.adminIds) || this.config.adminIds.length === 0) {
            console.error(`[${this.name}] Warning: Tidak ada admin yang terdaftar`);
        }

        if (!this.config.genieacs?.baseUrl) {
            console.error(`[${this.name}] Error: URL GenieACS tidak ditemukan`);
            return false;
        }

        return true;
    }

    isInitialized() {
        return !!this.bot;
    }

    // Helper untuk escape karakter HTML pada Telegram HTML Parse Mode
    escapeHtml(text) {
        if (text === null || text === undefined) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    loadCustomers() {
        try {
            const dataDir = path.join(__dirname, 'data');
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }
            
            const fileName = `customers_${this.config.serverId || 'default'}.json`;
            const filePath = path.join(dataDir, fileName);
            
            if (fs.existsSync(filePath)) {
                const data = fs.readFileSync(filePath, 'utf8');
                this.customers = JSON.parse(data);
            } else {
                this.customers = this.config.customers || {};
                fs.writeFileSync(filePath, JSON.stringify(this.customers, null, 2), 'utf8');
            }
        } catch (error) {
            console.error(`[${this.name}] Error loading customers:`, error.message);
            this.customers = this.config.customers || {};
        }
    }

    saveCustomers() {
        try {
            const dataDir = path.join(__dirname, 'data');
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }
            
            const fileName = `customers_${this.config.serverId || 'default'}.json`;
            const filePath = path.join(dataDir, fileName);
            fs.writeFileSync(filePath, JSON.stringify(this.customers, null, 2), 'utf8');
        } catch (error) {
            console.error(`[${this.name}] Error saving customers:`, error.message);
        }
    }

    // Extraction Fallbacks untuk TR-069 / TR-181 & VirtualParameters
    getDeviceSerialNumber(device) {
        if (!device) return '-';
        const vParams = device.VirtualParameters || {};
        const deviceInfo = device._deviceId || {};
        const igdInfo = device.InternetGatewayDevice?.DeviceInfo || {};
        const devInfo = device.Device?.DeviceInfo || {};

        return vParams.getSerialNumber?._value ||
            deviceInfo._SerialNumber ||
            igdInfo.SerialNumber?._value ||
            devInfo.SerialNumber?._value ||
            device._id ||
            '-';
    }

    getDevicePPPoEUsername(device) {
        if (!device) return '-';
        const vParams = device.VirtualParameters || {};
        const igdParams = device.InternetGatewayDevice || {};
        const pppConn = igdParams.WANDevice?.['1']?.WANConnectionDevice?.['1']?.WANPPPConnection?.['1'];
        const devPpp = device.Device?.PPP?.Interface?.['1'];

        return vParams.pppoeUsername?._value ||
            vParams.pppoeUsername2?._value ||
            pppConn?.Username?._value ||
            devPpp?.Username?._value ||
            '-';
    }

    getDevicePPPoEIP(device) {
        if (!device) return '-';
        const vParams = device.VirtualParameters || {};
        const igdParams = device.InternetGatewayDevice || {};
        const pppConn = igdParams.WANDevice?.['1']?.WANConnectionDevice?.['1']?.WANPPPConnection?.['1'];
        const ipConn = igdParams.WANDevice?.['1']?.WANConnectionDevice?.['1']?.WANIPConnection?.['1'];

        return vParams.pppoeIP?._value ||
            pppConn?.ExternalIPAddress?._value ||
            ipConn?.ExternalIPAddress?._value ||
            '-';
    }

    getDeviceRxPower(device) {
        if (!device) return '-';
        const vParams = device.VirtualParameters || {};
        return vParams.RXPower?._value ||
            vParams.redaman?._value ||
            device.InternetGatewayDevice?.WANDevice?.['1']?.WANConnectionDevice?.['1']?.WANIPConnection?.['1']?.Stats?.SignalStrength?._value ||
            '-';
    }

    getDeviceUptime(device) {
        if (!device) return '-';
        const vParams = device.VirtualParameters || {};
        return vParams.getdeviceuptime?._value ||
            device.InternetGatewayDevice?.DeviceInfo?.UpTime?._value ||
            device.Device?.DeviceInfo?.UpTime?._value ||
            '-';
    }

    getDeviceActiveUsers(device) {
        if (!device) return '0';
        const vParams = device.VirtualParameters || {};
        if (vParams.activedevices?._value !== undefined) return String(vParams.activedevices._value);
        if (vParams.userconnected?._value !== undefined) return String(vParams.userconnected._value);

        const wlanConfigs = device.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration || {};
        let total = 0;
        let found = false;
        for (const key of Object.keys(wlanConfigs)) {
            const wlan = wlanConfigs[key];
            if (wlan && wlan.TotalAssociations?._value !== undefined) {
                total += Number(wlan.TotalAssociations._value) || 0;
                found = true;
            }
        }
        return found ? String(total) : '0';
    }

    getBandDescription(index) {
        const num = Number(index);
        if (num >= 1 && num <= 4) return `2.4 GHz (SSID ${num})`;
        if (num >= 5 && num <= 8) return `5 GHz (SSID ${num})`;
        return `SSID ${num}`;
    }

    formatWiFiStatus(device, label = '') {
        if (!device) return '❌ Perangkat tidak ditemukan';

        const wlanConfigs = device.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration || {};
        const keys = Object.keys(wlanConfigs).sort((a, b) => Number(a) - Number(b));

        let message = `📡 <b>WiFi Status</b>\n\n`;
        if (label) {
            message += `Device: <code>${this.escapeHtml(label)}</code>\n\n`;
        }

        if (keys.length === 0) {
            message += '<i>Tidak ada konfigurasi WiFi yang ditemukan pada perangkat ini.</i>\n';
            return message;
        }

        let hasWlan = false;
        keys.forEach((key) => {
            const wlan = wlanConfigs[key];
            if (!wlan) return;

            const ssid = wlan.SSID?._value;
            const isEnabled = wlan.Enable?._value;
            const users = wlan.TotalAssociations?._value;
            const channel = wlan.Channel?._value;

            if (ssid !== undefined || isEnabled !== undefined || users !== undefined) {
                hasWlan = true;
                const indexNum = Number(key);
                let bandLabel = '';
                if (indexNum >= 1 && indexNum <= 4) {
                    bandLabel = ' (2.4 GHz)';
                } else if (indexNum >= 5 && indexNum <= 8) {
                    bandLabel = ' (5 GHz)';
                }

                const statusStr = (isEnabled === true || isEnabled === '1' || isEnabled === 1) ? '🟢 Enabled' : '🔴 Disabled';
                message += `📶 <b>SSID ${key}${bandLabel}:</b>\n`;
                message += `• Nama: <code>${this.escapeHtml(ssid || '-')}</code>\n`;
                message += `• Users: <code>${this.escapeHtml(String(users ?? '0'))}</code>\n`;
                if (channel !== undefined && channel !== null && channel !== '') {
                    message += `• Channel: <code>${this.escapeHtml(String(channel))}</code>\n`;
                }
                message += `• Status: ${statusStr}\n\n`;
            }
        });

        if (!hasWlan) {
            message += '<i>Tidak ada SSID aktif yang terdeteksi.</i>\n';
        }

        return message.trim();
    }

    parseAdminWiFiArgs(cmdName, searchTerm, restArgs) {
        let index = 1;
        const cmdMatch = cmdName.match(/^(?:setwifi|setpass)([1-8])$/i);
        let value = (restArgs || '').trim();

        if (cmdMatch) {
            index = parseInt(cmdMatch[1], 10);
        } else {
            const parts = value.split(/\s+/);
            if (parts.length >= 2 && /^[1-8]$/.test(parts[0])) {
                index = parseInt(parts[0], 10);
                value = parts.slice(1).join(' ').trim();
            }
        }

        return { searchTerm: searchTerm.trim(), index, value };
    }

    parseCustomerWiFiArgs(cmdName, restArgs) {
        let index = 1;
        const cmdMatch = cmdName.match(/^(?:changepass|changessid)([1-8])$/i);
        let value = (restArgs || '').trim();

        if (cmdMatch) {
            index = parseInt(cmdMatch[1], 10);
        } else {
            const parts = value.split(/\s+/);
            if (parts.length >= 2 && /^[1-8]$/.test(parts[0])) {
                index = parseInt(parts[0], 10);
                value = parts.slice(1).join(' ').trim();
            }
        }

        return { index, value };
    }

    getWiFiInlineKeyboard(device, searchTerm) {
        if (!device) return null;
        const wlanConfigs = device.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration || {};
        const keys = Object.keys(wlanConfigs).sort((a, b) => Number(a) - Number(b));

        const inline_keyboard = [];
        keys.forEach((key) => {
            const wlan = wlanConfigs[key];
            if (!wlan) return;

            const ssid = wlan.SSID?._value;
            const isEnabled = wlan.Enable?._value;
            const users = wlan.TotalAssociations?._value;

            if (ssid !== undefined || isEnabled !== undefined || users !== undefined) {
                const num = Number(key);
                let label = `SSID ${key}`;
                if (num >= 1 && num <= 4) label += ' (2.4G)';
                else if (num >= 5 && num <= 8) label += ' (5G)';

                inline_keyboard.push([
                    { text: `✏️ Ubah ${label}`, callback_data: `edit_ssid:${searchTerm}:${key}` },
                    { text: `🔑 Ubah Pass ${key}`, callback_data: `edit_pass:${searchTerm}:${key}` }
                ]);
            }
        });

        inline_keyboard.push([
            { text: '🔄 Refresh WiFi', callback_data: `wifi:${searchTerm}` }
        ]);

        return { inline_keyboard };
    }

    isDeviceOnline(device) {
        if (!device) return false;
        if (device.Events?.Registered?._value) return true;
        if (device._lastInform) {
            const diff = Date.now() - new Date(device._lastInform).getTime();
            if (diff < 300000) return true; // Online if informed in last 5 minutes
        }
        const pppIp = this.getDevicePPPoEIP(device);
        if (pppIp && pppIp !== '-') return true;
        return false;
    }

    setupHandlers() {
        this.bot.on('message', async (msg) => {
            const chatId = msg.chat.id;
            const chatIdStr = chatId.toString();
            console.log(`[${Date.now()}] Received message from ${chatId}:`, msg.text);

            if (!msg.text) return;

            if (msg.text === '/cancel') {
                if (this.userSessions[chatIdStr]) {
                    delete this.userSessions[chatIdStr];
                    return this.bot.sendMessage(chatId, '❌ Perubahan dibatalkan.', { parse_mode: 'HTML' });
                }
            }

            const session = this.userSessions[chatIdStr];
            if (session) {
                if (Date.now() > session.expiresAt) {
                    delete this.userSessions[chatIdStr];
                } else if (!msg.text.startsWith('/')) {
                    const { action, searchTerm, index } = session;
                    delete this.userSessions[chatIdStr];

                    const bandInfo = this.getBandDescription(index);

                    if (action === 'set_ssid') {
                        const newSSID = msg.text.trim();
                        if (!newSSID) {
                            return this.bot.sendMessage(chatId, '❌ Nama WiFi tidak boleh kosong.');
                        }
                        try {
                            await this.setWiFiSSID(searchTerm, newSSID, index);
                            return this.bot.sendMessage(chatId,
                                '✅ <b>Nama WiFi berhasil diubah!</b>\n\n' +
                                `Perangkat: <code>${this.escapeHtml(searchTerm)}</code>\n` +
                                `Target: <b>${this.escapeHtml(bandInfo)}</b>\n` +
                                `SSID Baru: <code>${this.escapeHtml(newSSID)}</code>\n\n` +
                                `❗ Hanya SSID ${index} yang diubah, SSID lainnya tidak terpengaruh\n` +
                                '❗ Perangkat yang terhubung perlu reconnect',
                                { parse_mode: 'HTML' }
                            );
                        } catch (err) {
                            console.error(`[${this.name}] Interactive set_ssid error:`, err);
                            return this.bot.sendMessage(chatId, '❌ Gagal mengubah nama WiFi');
                        }
                    } else if (action === 'set_pass') {
                        const newPassword = msg.text.trim();
                        if (newPassword.length < 8) {
                            this.userSessions[chatIdStr] = session;
                            return this.bot.sendMessage(chatId, '❌ Password harus minimal 8 karakter!\n\nSilakan ketik ulang password baru atau ketik /cancel untuk membatalkan.', { parse_mode: 'HTML' });
                        }
                        try {
                            await this.setWiFiPassword(searchTerm, newPassword, index);
                            return this.bot.sendMessage(chatId,
                                '✅ <b>Password WiFi berhasil diubah!</b>\n\n' +
                                `Perangkat: <code>${this.escapeHtml(searchTerm)}</code>\n` +
                                `Target: <b>${this.escapeHtml(bandInfo)}</b>\n` +
                                `Password Baru: <code>${this.escapeHtml(newPassword)}</code>\n\n` +
                                `❗ Hanya password SSID ${index} yang diubah, SSID lainnya tidak terpengaruh\n` +
                                '❗ Perangkat yang terhubung perlu reconnect',
                                { parse_mode: 'HTML' }
                            );
                        } catch (err) {
                            console.error(`[${this.name}] Interactive set_pass error:`, err);
                            return this.bot.sendMessage(chatId, '❌ Gagal mengubah password WiFi');
                        }
                    }
                }
            }

            if (msg.text === '/star') {
                this.bot.emit('text', msg, ['/start']);
            }
        });

        // /myid
        this.bot.onText(/\/myid/, (msg) => {
            const chatId = msg.chat.id;
            this.bot.sendMessage(chatId, 
                '🆔 <b>ID Telegram Anda</b>\n\n' +
                `ID: <code>${chatId}</code>\n\n` +
                '❗ Berikan ID ini kepada admin untuk didaftarkan',
                { parse_mode: 'HTML' }
            );
        });

        // /start
        this.bot.onText(/\/start/, (msg) => {
            const chatId = msg.chat.id;
            const isAdmin = this.config.adminIds.includes(chatId.toString());
            const customer = this.customers[chatId.toString()];
            
            if (!isAdmin && !customer) {
                this.bot.sendMessage(chatId, 
                    '👋 <b>Selamat datang di Bot GenieACS</b>\n\n' +
                    '⚠️ Anda belum terdaftar dalam sistem.\n\n' +
                    '📱 <b>Untuk mendaftar:</b>\n' +
                    '1. Gunakan perintah /myid\n' +
                    '2. Copy ID Telegram Anda\n' +
                    '3. Berikan ID tersebut ke admin\n\n' +
                    '❗ Admin akan mendaftarkan perangkat Anda',
                    { parse_mode: 'HTML' }
                );
                return;
            }
            
            if (isAdmin) {
                const helpMessage = 
                    `🏢 <b>ALIJAYA GENIEACS BOT</b>\n` +
                    `🏢 <b>${this.escapeHtml(this.name)} Admin Panel</b>\n\n` +
                    '📱 <b>Perintah Admin:</b>\n' +
                    '/devices - Lihat semua device\n' +
                    '/customers - Lihat daftar pelanggan\n' +
                    '/finduser {USERNAME} - Cari device dari PPPoE username\n' +
                    '/addcustomer {ID_TELEGRAM} {NAMA} {DEVICE_SN} - Tambah pelanggan\n' +
                    '/delcustomer {ID_TELEGRAM} - Hapus pelanggan\n' +
                    '/status {SN/USERNAME} - Cek status device\n' +
                    '/signal {SN/USERNAME} - Cek signal device\n' +
                    '/reboot {SN/USERNAME} - Reboot device\n' +
                    '/wifi {SN/USERNAME} - Cek status semua WiFi (2.4G & 5G)\n' +
                    '/setwifi {SN/USERNAME} [INDEX] {SSID} - Ganti nama WiFi (Default: SSID 1)\n' +
                    '/setwifi1 s/d /setwifi8 {SN/USERNAME} {SSID} - Ganti nama SSID tertentu\n' +
                    '/setpass {SN/USERNAME} [INDEX] {PASSWORD} - Ganti password WiFi (Default: SSID 1)\n' +
                    '/setpass1 s/d /setpass8 {SN/USERNAME} {PASSWORD} - Ganti password SSID tertentu\n' +
                    '/addwan {SN/USERNAME} {WAN_USER} {WAN_PASS} - Set WAN credentials\n' +
                    '/users {SN/USERNAME} - Cek user terhubung\n\n' +
                    '<b>Contoh Ganti WiFi per SSID:</b>\n' +
                    '• 2.4G SSID 1: <code>/setwifi1 ZTEGC8F12345 WiFi_Utama</code>\n' +
                    '• 2.4G SSID 2: <code>/setwifi2 ZTEGC8F12345 WiFi_Tamu</code>\n' +
                    '• 5G SSID 5: <code>/setwifi5 ZTEGC8F12345 WiFi_Cepat_5G</code>\n' +
                    '• Password 5G: <code>/setpass5 ZTEGC8F12345 rahasia5G123</code>\n\n' +
                    '<b>Cara Menambah Pelanggan:</b>\n' +
                    '1. Minta pelanggan kirim /myid ke bot\n' +
                    '2. Gunakan ID tersebut di perintah /addcustomer\n' +
                    '3. Contoh: <code>/addcustomer 123456789 John Doe ZTEGC8F12345</code>\n' +
                    '   atau: <code>/addcustomer 123456789 "John Doe" ZTEGC8F12345</code>\n\n' +
                    '❗ ID Telegram berbeda dengan nomor telepon';

                this.sendLongMessage(chatId, helpMessage, { parse_mode: 'HTML' });
            } else {
                this.bot.sendMessage(chatId, 
                    `👋 <b>Selamat datang ${this.escapeHtml(customer.name)}</b>\n\n` +
                    '📱 <b>Perintah yang tersedia:</b>\n' +
                    '/mystatus - Cek status perangkat Anda\n' +
                    '/mywifi - Cek status WiFi (2.4 GHz & 5 GHz)\n' +
                    '/changepass [INDEX] {PASSWORD} - Ganti password WiFi\n' +
                    '/changepass1 s/d /changepass8 {PASSWORD} - Ganti password SSID tertentu\n' +
                    '/changessid [INDEX] {SSID} - Ganti nama WiFi\n' +
                    '/changessid1 s/d /changessid8 {SSID} - Ganti nama SSID tertentu\n\n' +
                    '<b>Contoh:</b>\n' +
                    '• Ganti Password 2.4G (SSID 1): <code>/changepass1 passBaru123</code>\n' +
                    '• Ganti Password 5G (SSID 5): <code>/changepass5 passBaru5G123</code>\n' +
                    '• Ganti Nama 5G (SSID 5): <code>/changessid5 Rumah_5G</code>\n\n' +
                    '❗ Password WiFi minimal 8 karakter\n' +
                    '❗ Setiap SSID berdiri sendiri dan tidak saling mempengaruhi',
                    { parse_mode: 'HTML' }
                );
            }
        });

        // /mystatus (Customer)
        this.bot.onText(/\/mystatus/, async (msg) => {
            const chatId = msg.chat.id;
            const customer = this.customers[chatId.toString()];
            if (!customer) return;

            try {
                const device = await this.getDeviceInfo(customer.deviceSN);
                if (!device) {
                    this.bot.sendMessage(chatId, '❌ Perangkat tidak ditemukan');
                    return;
                }

                const isOnline = this.isDeviceOnline(device);
                const status = isOnline ? '🟢 Online' : '🔴 Offline';
                const rxPower = this.getDeviceRxPower(device);
                const pppoeIp = this.getDevicePPPoEIP(device);
                const uptime = this.getDeviceUptime(device);

                const message = 
                    `📱 <b>Status Perangkat Anda</b>\n\n` +
                    `Pelanggan: ${this.escapeHtml(customer.name)}\n` +
                    `Status: ${status}\n` +
                    `Signal: <code>${this.escapeHtml(rxPower)} dBm</code>\n` +
                    `IP: <code>${this.escapeHtml(pppoeIp)}</code>\n` +
                    `Uptime: <code>${this.escapeHtml(uptime)}</code>\n`;

                const options = {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '📡 Cek WiFi', callback_data: `wifi:${customer.deviceSN}` }]
                        ]
                    }
                };
                this.bot.sendMessage(chatId, message, options);
            } catch (error) {
                this.bot.sendMessage(chatId, '❌ Gagal mengambil status perangkat');
            }
        });

        // /mywifi (Customer)
        this.bot.onText(/\/mywifi/, async (msg) => {
            const chatId = msg.chat.id;
            const customer = this.customers[chatId.toString()];
            if (!customer) return;

            try {
                const device = await this.getDeviceInfo(customer.deviceSN);
                if (!device) {
                    this.bot.sendMessage(chatId, '❌ Perangkat tidak ditemukan');
                    return;
                }

                const message = this.formatWiFiStatus(device);
                const keyboard = this.getWiFiInlineKeyboard(device, customer.deviceSN);
                this.bot.sendMessage(chatId, message, {
                    parse_mode: 'HTML',
                    reply_markup: keyboard
                });
            } catch (error) {
                this.bot.sendMessage(chatId, '❌ Gagal mengambil status WiFi');
            }
        });

        // /changepass / /changepass[1-8] (Customer)
        this.bot.onText(/\/(changepass[1-8]|changepass)\s+(.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            const customer = this.customers[chatId.toString()];
            if (!customer) return;

            const cmdName = match[1];
            const rawArgs = match[2];
            const { index, value: newPassword } = this.parseCustomerWiFiArgs(cmdName, rawArgs);

            if (!newPassword || newPassword.length < 8) {
                this.bot.sendMessage(chatId, '❌ Password harus minimal 8 karakter');
                return;
            }

            try {
                await this.setWiFiPassword(customer.deviceSN, newPassword, index);
                const bandInfo = this.getBandDescription(index);
                this.bot.sendMessage(chatId, 
                    '✅ <b>Password WiFi berhasil diubah!</b>\n\n' +
                    `Target: <b>${this.escapeHtml(bandInfo)}</b>\n` +
                    `Password baru: <code>${this.escapeHtml(newPassword)}</code>\n\n` +
                    `❗ Hanya password SSID ${index} yang diubah, SSID lainnya tidak terpengaruh\n` +
                    '❗ Perangkat yang terhubung ke SSID ini perlu reconnect',
                    { parse_mode: 'HTML' }
                );
            } catch (error) {
                console.error(`[${this.name}] Error in changepass:`, error);
                this.bot.sendMessage(chatId, '❌ Gagal mengubah password WiFi');
            }
        });

        // /changessid / /changessid[1-8] (Customer)
        this.bot.onText(/\/(changessid[1-8]|changessid)\s+(.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            const customer = this.customers[chatId.toString()];
            if (!customer) return;

            const cmdName = match[1];
            const rawArgs = match[2];
            const { index, value: newSSID } = this.parseCustomerWiFiArgs(cmdName, rawArgs);

            if (!newSSID) {
                this.bot.sendMessage(chatId, '❌ Nama SSID tidak boleh kosong');
                return;
            }

            try {
                await this.setWiFiSSID(customer.deviceSN, newSSID, index);
                const bandInfo = this.getBandDescription(index);
                this.bot.sendMessage(chatId, 
                    '✅ <b>Nama WiFi berhasil diubah!</b>\n\n' +
                    `Target: <b>${this.escapeHtml(bandInfo)}</b>\n` +
                    `SSID Baru: <code>${this.escapeHtml(newSSID)}</code>\n\n` +
                    `❗ Hanya SSID ${index} yang diubah, SSID lainnya tidak terpengaruh\n` +
                    '❗ Perangkat yang terhubung perlu reconnect',
                    { parse_mode: 'HTML' }
                );
            } catch (error) {
                console.error(`[${this.name}] Error in changessid:`, error);
                this.bot.sendMessage(chatId, '❌ Gagal mengubah nama WiFi');
            }
        });

        // /setwifi / /setwifi[1-8] (Admin)
        this.bot.onText(/\/(setwifi[1-8]|setwifi)\s+(\S+)\s+(.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            if (!this.config.adminIds.includes(chatId.toString())) return;

            const cmdName = match[1];
            const searchTerm = match[2];
            const rawArgs = match[3];
            const { index, value: newSSID } = this.parseAdminWiFiArgs(cmdName, searchTerm, rawArgs);

            if (!newSSID) {
                this.bot.sendMessage(chatId, '❌ Nama SSID tidak boleh kosong');
                return;
            }
            
            try {
                await this.setWiFiSSID(searchTerm, newSSID, index);
                const bandInfo = this.getBandDescription(index);
                await this.bot.sendMessage(chatId, 
                    '✅ <b>Nama WiFi berhasil diubah!</b>\n\n' +
                    `Perangkat: <code>${this.escapeHtml(searchTerm)}</code>\n` +
                    `Target: <b>${this.escapeHtml(bandInfo)}</b>\n` +
                    `SSID Baru: <code>${this.escapeHtml(newSSID)}</code>\n\n` +
                    `❗ Hanya SSID ${index} yang diubah, SSID lainnya tidak terpengaruh\n` +
                    '❗ Perangkat yang terhubung perlu reconnect',
                    { parse_mode: 'HTML' }
                );
            } catch (error) {
                console.error(`[${Date.now()}] Error in /setwifi handler:`, error);
                let errorMessage = '❌ Gagal mengubah nama WiFi';
                if (error.response) {
                    if (error.response.status === 404) errorMessage = '❌ Device tidak ditemukan';
                    else if (error.response.status === 400) errorMessage = '❌ Parameter tidak valid';
                }
                await this.bot.sendMessage(chatId, errorMessage);
            }
        });

        // /devices (Admin)
        this.bot.onText(/\/devices/, async (msg) => {
            const chatId = msg.chat.id;
            if (!this.config.adminIds.includes(chatId.toString())) return;

            try {
                const devices = await this.getDevicesFromGenieACS();
                if (!devices || devices.length === 0) {
                    await this.bot.sendMessage(chatId, '❌ Tidak ada device yang ditemukan');
                    return;
                }

                let message = '📱 <b>Daftar Device</b>\n\n';
                
                devices.forEach((device, index) => {
                    try {
                        const serialNumber = this.getDeviceSerialNumber(device);
                        const isOnline = this.isDeviceOnline(device);
                        const status = isOnline ? '🟢 Online' : '🔴 Offline';
                        const pppoeUser = this.getDevicePPPoEUsername(device);
                        const pppoeIp = this.getDevicePPPoEIP(device);
                        const rxPower = this.getDeviceRxPower(device);
                        const uptime = this.getDeviceUptime(device);
                        const activeUsers = this.getDeviceActiveUsers(device);
                        const deviceInfo = device._deviceId || {};
                        const model = deviceInfo._ProductClass || '-';
                        const manufacturer = deviceInfo._Manufacturer || '-';

                        message += `${index + 1}. <b>${this.escapeHtml(serialNumber)}</b> (${status})\n`;
                        message += `Device ID: <code>${this.escapeHtml(device._id)}</code>\n`;
                        message += `Model: <code>${this.escapeHtml(manufacturer)} - ${this.escapeHtml(model)}</code>\n`;
                        message += `👤 Username: <code>${this.escapeHtml(pppoeUser)}</code>\n`;
                        message += `📡 IP: <code>${this.escapeHtml(pppoeIp)}</code>\n`;
                        message += `📶 Signal: <code>${this.escapeHtml(rxPower)} dBm</code>\n`;
                        message += `⏱️ Uptime: <code>${this.escapeHtml(uptime)}</code>\n`;
                        message += `👥 Users: <code>${this.escapeHtml(activeUsers)}</code>\n`;
                        
                        const cmdKey = pppoeUser !== '-' ? pppoeUser : serialNumber;
                        message += `<b>Quick Commands:</b>\n`;
                        message += `• /status <code>${this.escapeHtml(cmdKey)}</code>\n`;
                        message += `• /wifi <code>${this.escapeHtml(cmdKey)}</code>\n`;
                        message += `• /reboot <code>${this.escapeHtml(cmdKey)}</code>\n\n`;
                        message += `-----------------------------------\n\n`;
                    } catch (error) {
                        console.error(`[${Date.now()}] Error processing device ${index + 1}:`, error);
                        message += `${index + 1}. <b>Error processing device</b>\n\n`;
                    }
                });

                await this.sendLongMessage(chatId, message, { parse_mode: 'HTML' });
            } catch (error) {
                console.error(`[${Date.now()}] Error processing /devices:`, error);
                await this.bot.sendMessage(chatId, '❌ Terjadi kesalahan saat mengambil data device.');
            }
        });

        // /finduser (Admin)
        this.bot.onText(/\/finduser (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            if (!this.config.adminIds.includes(chatId.toString())) return;

            const username = match[1].trim();
            try {
                const devices = await this.getDevicesFromGenieACS();
                let foundDevice = null;
                
                for (const device of devices) {
                    if (this.getDevicePPPoEUsername(device) === username) {
                        foundDevice = device;
                        break;
                    }
                }

                if (foundDevice) {
                    const serialNumber = this.getDeviceSerialNumber(foundDevice);
                    const message = 
                        `✅ <b>Pengguna Ditemukan!</b>\n\n` +
                        `👤 Username: <code>${this.escapeHtml(username)}</code>\n` +
                        `📱 Serial Number: <code>${this.escapeHtml(serialNumber)}</code>\n\n` +
                        '<b>Quick Command untuk menambahkan pelanggan:</b>\n' +
                        `<code>/addcustomer {TELEGRAM_ID} "Nama Pelanggan" ${this.escapeHtml(serialNumber)}</code>\n\n` +
                        '❗ Ganti {TELEGRAM_ID} dengan ID dari /myid';

                    await this.bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
                } else {
                    await this.bot.sendMessage(chatId, '❌ Username tidak ditemukan di perangkat manapun.');
                }
            } catch (error) {
                console.error(`[${Date.now()}] Error finding user:`, error);
                await this.bot.sendMessage(chatId, '❌ Gagal mencari pengguna');
            }
        });

        // /status (Admin)
        this.bot.onText(/\/status (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            if (!this.config.adminIds.includes(chatId.toString())) return;

            const searchTerm = match[1].trim();
            try {
                const device = await this.findDevice(searchTerm);
                if (device) {
                    const serialNumber = this.getDeviceSerialNumber(device);
                    const isOnline = this.isDeviceOnline(device);
                    const status = isOnline ? '🟢 Online' : '🔴 Offline';
                    const pppoeUser = this.getDevicePPPoEUsername(device);
                    const pppoeIp = this.getDevicePPPoEIP(device);
                    const rxPower = this.getDeviceRxPower(device);
                    const uptime = this.getDeviceUptime(device);
                    const activeUsers = this.getDeviceActiveUsers(device);
                    const deviceInfo = device._deviceId || {};

                    const message = 
                        `📱 <b>Informasi Device</b>\n\n` +
                        `<b>Device Info:</b>\n` +
                        `SN: <code>${this.escapeHtml(serialNumber)}</code>\n` +
                        `Model: <code>${this.escapeHtml(deviceInfo._Manufacturer || '-')} ${this.escapeHtml(deviceInfo._ProductClass || '-')}</code>\n\n` +
                        
                        `<b>Status:</b>\n` +
                        `Status: ${status}\n` +
                        `Device Uptime: <code>${this.escapeHtml(uptime)}</code>\n\n` +
                        
                        `<b>PPPoE:</b>\n` +
                        `Username: <code>${this.escapeHtml(pppoeUser)}</code>\n` +
                        `IP: <code>${this.escapeHtml(pppoeIp)}</code>\n\n` +
                        
                        `<b>Signal:</b>\n` +
                        `RX Power: <code>${this.escapeHtml(rxPower)} dBm</code>\n\n` +
                        
                        `<b>WiFi:</b>\n` +
                        `Connected Users: <code>${this.escapeHtml(activeUsers)}</code>\n\n` +
                        
                        '<b>Quick Commands:</b>\n' +
                        `• /wifi <code>${this.escapeHtml(searchTerm)}</code>\n` +
                        `• /setwifi1 <code>${this.escapeHtml(searchTerm)} SSID_2.4G</code>\n` +
                        `• /setwifi5 <code>${this.escapeHtml(searchTerm)} SSID_5G</code>\n` +
                        `• /setpass1 <code>${this.escapeHtml(searchTerm)} PASS_2.4G</code>\n` +
                        `• /setpass5 <code>${this.escapeHtml(searchTerm)} PASS_5G</code>\n` +
                        `• /reboot <code>${this.escapeHtml(searchTerm)}</code>`;

                    const options = {
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: '📡 WiFi', callback_data: `wifi:${searchTerm}` },
                                    { text: '👥 Users', callback_data: `users:${searchTerm}` }
                                ],
                                [
                                    { text: '📶 Signal', callback_data: `signal:${searchTerm}` },
                                    { text: '🔄 Reboot', callback_data: `reboot:${searchTerm}` }
                                ]
                            ]
                        }
                    };
                    await this.bot.sendMessage(chatId, message, options);
                } else {
                    await this.bot.sendMessage(chatId, '❌ Device tidak ditemukan. Gunakan Serial Number atau PPPoE Username.');
                }
            } catch (error) {
                console.error(`[${Date.now()}] Error checking status:`, error);
                await this.bot.sendMessage(chatId, '❌ Gagal mengambil status device');
            }
        });

        // /wifi (Admin)
        this.bot.onText(/\/wifi (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            if (!this.config.adminIds.includes(chatId.toString())) return;

            const searchTerm = match[1].trim();
            try {
                const device = await this.findDevice(searchTerm);
                if (!device) {
                    this.bot.sendMessage(chatId, '❌ Device tidak ditemukan');
                    return;
                }

                const message = this.formatWiFiStatus(device, searchTerm);
                const keyboard = this.getWiFiInlineKeyboard(device, searchTerm);
                this.bot.sendMessage(chatId, message, {
                    parse_mode: 'HTML',
                    reply_markup: keyboard
                });
            } catch (error) {
                console.error(`[${this.name}] Error:`, error);
                this.bot.sendMessage(chatId, '❌ Gagal mengambil status WiFi');
            }
        });

        // /setpass / /setpass[1-8] (Admin)
        this.bot.onText(/\/(setpass[1-8]|setpass)\s+(\S+)\s+(.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            if (!this.config.adminIds.includes(chatId.toString())) return;

            const cmdName = match[1];
            const searchTerm = match[2];
            const rawArgs = match[3];
            const { index, value: newPassword } = this.parseAdminWiFiArgs(cmdName, searchTerm, rawArgs);

            if (!newPassword || newPassword.length < 8) {
                this.bot.sendMessage(chatId, '❌ Password harus minimal 8 karakter');
                return;
            }
            
            try {
                await this.setWiFiPassword(searchTerm, newPassword, index);
                const bandInfo = this.getBandDescription(index);
                await this.bot.sendMessage(chatId, 
                    '✅ <b>Password WiFi berhasil diubah!</b>\n\n' +
                    `Perangkat: <code>${this.escapeHtml(searchTerm)}</code>\n` +
                    `Target: <b>${this.escapeHtml(bandInfo)}</b>\n` +
                    `Password Baru: <code>${this.escapeHtml(newPassword)}</code>\n\n` +
                    `❗ Hanya password SSID ${index} yang diubah, SSID lainnya tidak terpengaruh\n` +
                    '❗ Perangkat yang terhubung perlu reconnect',
                    { parse_mode: 'HTML' }
                );
            } catch (error) {
                console.error(`[${Date.now()}] Error in /setpass handler:`, error);
                await this.bot.sendMessage(chatId, '❌ Gagal mengubah password WiFi');
            }
        });

        // /reboot (Admin)
        this.bot.onText(/\/reboot (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            if (!this.config.adminIds.includes(chatId.toString())) return;

            const searchTerm = match[1].trim();
            try {
                await this.rebootDevice(searchTerm);
                await this.bot.sendMessage(chatId, 
                    `✅ <b>Perintah reboot berhasil dikirim!</b>\n\n` +
                    `Device: <code>${this.escapeHtml(searchTerm)}</code>\n\n` +
                    '❗ Perangkat akan segera restart', 
                    { parse_mode: 'HTML' }
                );
            } catch (error) {
                console.error(`[${Date.now()}] Error in /reboot handler:`, error);
                await this.bot.sendMessage(chatId, '❌ Gagal melakukan reboot device');
            }
        });

        // /signal (Admin)
        this.bot.onText(/\/signal (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            if (!this.config.adminIds.includes(chatId.toString())) return;

            const searchTerm = match[1].trim();
            try {
                const device = await this.findDevice(searchTerm);
                if (!device) {
                    await this.bot.sendMessage(chatId, '❌ Device tidak ditemukan');
                    return;
                }
                
                const rxPower = this.getDeviceRxPower(device);
                const message = 
                    `📶 <b>Status Signal</b>\n\n` +
                    `Device: <code>${this.escapeHtml(searchTerm)}</code>\n` +
                    `Signal RX: <code>${this.escapeHtml(rxPower)} dBm</code>`;
                await this.bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
            } catch (error) {
                console.error(`[${Date.now()}] Error in /signal handler:`, error);
                await this.bot.sendMessage(chatId, '❌ Gagal mengambil status signal');
            }
        });

        // /users (Admin)
        this.bot.onText(/\/users (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            if (!this.config.adminIds.includes(chatId.toString())) return;

            const searchTerm = match[1].trim();
            try {
                const device = await this.findDevice(searchTerm);
                if (!device) {
                    await this.bot.sendMessage(chatId, '❌ Device tidak ditemukan');
                    return;
                }
                
                const activeDevices = this.getDeviceActiveUsers(device);
                const message = 
                    `👥 <b>User Terhubung</b>\n\n` +
                    `Device: <code>${this.escapeHtml(searchTerm)}</code>\n` +
                    `Jumlah User Aktif: <code>${this.escapeHtml(activeDevices)}</code>`;
                await this.bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
            } catch (error) {
                console.error(`[${Date.now()}] Error in /users handler:`, error);
                await this.bot.sendMessage(chatId, '❌ Gagal mengambil data user terhubung');
            }
        });

        // /addwan (Admin)
        this.bot.onText(/\/addwan (\S+) (\S+) (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            if (!this.config.adminIds.includes(chatId.toString())) return;

            const [_, deviceId, username, password] = match;
            try {
                await this.setWANCredentials(deviceId, username.trim(), password.trim());
                this.bot.sendMessage(chatId, 
                    '✅ <b>WAN Credentials berhasil diatur!</b>\n\n' +
                    `Device: <code>${this.escapeHtml(deviceId)}</code>\n` +
                    `Username: <code>${this.escapeHtml(username)}</code>\n` +
                    `Password: <code>${this.escapeHtml(password)}</code>`,
                    { parse_mode: 'HTML' }
                );
            } catch (error) {
                console.error(`[${this.name}] Error setting WAN credentials:`, error);
                this.bot.sendMessage(chatId, '❌ Gagal mengatur WAN credentials');
            }
        });

        // /addcustomer (Admin) - Dukung dengan/tanpa petik
        this.bot.onText(/\/addcustomer (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            if (!this.config.adminIds.includes(chatId.toString())) return;

            const rawArgs = match[1].trim();
            let telegramId, customerName, deviceSN;

            const quotedMatch = rawArgs.match(/^(\S+)\s+"([^"]+)"\s+(\S+)$/);
            if (quotedMatch) {
                [_, telegramId, customerName, deviceSN] = quotedMatch;
            } else {
                const parts = rawArgs.split(/\s+/);
                if (parts.length >= 3) {
                    telegramId = parts[0];
                    deviceSN = parts[parts.length - 1];
                    customerName = parts.slice(1, parts.length - 1).join(' ');
                }
            }

            if (!telegramId || !customerName || !deviceSN) {
                return this.bot.sendMessage(chatId,
                    '❌ <b>Format /addcustomer salah!</b>\n\n' +
                    'Gunakan salah satu format:\n' +
                    '• <code>/addcustomer 123456789 "John Doe" ZTEGC8F12345</code>\n' +
                    '• <code>/addcustomer 123456789 John Doe ZTEGC8F12345</code>',
                    { parse_mode: 'HTML' }
                );
            }

            try {
                const device = await this.getDeviceInfo(deviceSN);
                if (!device) {
                    this.bot.sendMessage(chatId, '❌ Device tidak ditemukan di GenieACS');
                    return;
                }

                this.customers[telegramId] = {
                    name: customerName,
                    deviceSN: deviceSN,
                    allowedCommands: ["wifi-status", "wifi-password", "wifi-ssid"]
                };

                this.saveCustomers();

                this.bot.sendMessage(chatId, 
                    '✅ <b>Pelanggan berhasil ditambahkan!</b>\n\n' +
                    `Nama: <code>${this.escapeHtml(customerName)}</code>\n` +
                    `Telegram ID: <code>${this.escapeHtml(telegramId)}</code>\n` +
                    `Device SN: <code>${this.escapeHtml(deviceSN)}</code>\n\n` +
                    '<b>Quick Commands:</b>\n' +
                    `• /delcustomer <code>${this.escapeHtml(telegramId)}</code>\n` +
                    `• /status <code>${this.escapeHtml(deviceSN)}</code>`,
                    { parse_mode: 'HTML' }
                );

                try {
                    await this.bot.sendMessage(telegramId, 
                        `✅ <b>Selamat datang di ${this.escapeHtml(this.name)}!</b>\n\n` +
                        `Halo ${this.escapeHtml(customerName)}, akun Anda telah didaftarkan.\n\n` +
                        '📱 <b>Perintah yang tersedia:</b>\n' +
                        '/mystatus - Cek status perangkat\n' +
                        '/mywifi - Cek status WiFi (2.4G & 5G)\n' +
                        '/changepass [INDEX] {PASSWORD} - Ganti password WiFi\n' +
                        '/changepass1 s/d /changepass8 {PASSWORD} - Ganti password SSID tertentu\n' +
                        '/changessid [INDEX] {SSID} - Ganti nama WiFi\n' +
                        '/changessid1 s/d /changessid8 {SSID} - Ganti nama SSID tertentu\n\n' +
                        '❗ Password WiFi minimal 8 karakter\n' +
                        '❗ Setiap SSID berdiri sendiri dan tidak saling mempengaruhi',
                        { parse_mode: 'HTML' }
                    );
                } catch (error) {
                    this.bot.sendMessage(chatId, 
                        '⚠️ <b>Peringatan:</b> Pelanggan berhasil ditambahkan tapi gagal mengirim pesan selamat datang. Pastikan pelanggan sudah menekan /start di bot.',
                        { parse_mode: 'HTML' }
                    );
                }
            } catch (error) {
                console.error(`[${this.name}] Error adding customer:`, error);
                this.bot.sendMessage(chatId, '❌ Gagal menambahkan pelanggan');
            }
        });

        // /delcustomer (Admin)
        this.bot.onText(/\/delcustomer (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            if (!this.config.adminIds.includes(chatId.toString())) return;

            const telegramId = match[1].trim();
            try {
                const customer = this.customers?.[telegramId];
                if (!customer) {
                    this.bot.sendMessage(chatId, '❌ Pelanggan tidak ditemukan');
                    return;
                }

                delete this.customers[telegramId];
                this.saveCustomers();

                this.bot.sendMessage(chatId, 
                    '✅ <b>Pelanggan berhasil dihapus!</b>\n\n' +
                    `Nama: <code>${this.escapeHtml(customer.name)}</code>\n` +
                    `Telegram ID: <code>${this.escapeHtml(telegramId)}</code>\n` +
                    `Device SN: <code>${this.escapeHtml(customer.deviceSN)}</code>`,
                    { parse_mode: 'HTML' }
                );

                try {
                    await this.bot.sendMessage(telegramId, 
                        '⚠️ <b>Pemberitahuan</b>\n\n' +
                        'Akun Anda telah dinonaktifkan. Silakan hubungi admin untuk informasi lebih lanjut.',
                        { parse_mode: 'HTML' }
                    );
                } catch (error) {}
            } catch (error) {
                console.error(`[${this.name}] Error deleting customer:`, error);
                this.bot.sendMessage(chatId, '❌ Gagal menghapus pelanggan');
            }
        });

        // /customers (Admin)
        this.bot.onText(/\/customers/, async (msg) => {
            const chatId = msg.chat.id;
            if (!this.config.adminIds.includes(chatId.toString())) return;

            try {
                const customerEntries = Object.entries(this.customers || {});
                let message = '👥 <b>Daftar Pelanggan</b>\n\n';
                
                customerEntries.forEach(([telegramId, customer], index) => {
                    message += `${index + 1}. <b>${this.escapeHtml(customer.name)}</b>\n`;
                    message += `📱 Telegram ID: <code>${this.escapeHtml(telegramId)}</code>\n`;
                    message += `📶 Device SN: <code>${this.escapeHtml(customer.deviceSN)}</code>\n\n`;
                    message += '<b>Quick Commands:</b>\n';
                    message += `• /status <code>${this.escapeHtml(customer.deviceSN)}</code>\n`;
                    message += `• /delcustomer <code>${this.escapeHtml(telegramId)}</code>\n`;
                    message += '-----------------------------------\n\n';
                });

                if (customerEntries.length === 0) {
                    message += 'Belum ada pelanggan terdaftar.\n\n';
                }

                message += '<b>Cara Menambah Pelanggan Baru:</b>\n';
                message += '1. Minta pelanggan kirim /myid ke bot\n';
                message += '2. Gunakan format berikut:\n';
                message += '<code>/addcustomer {ID_TELEGRAM} "NAMA" {DEVICE_SN}</code>\n\n';
                message += '❗ Contoh: <code>/addcustomer 123456789 "John Doe" ZTEGC8F12345</code>\n';
                
                await this.sendLongMessage(chatId, message, { parse_mode: 'HTML' });
            } catch (error) {
                console.error(`[${this.name}] Error listing customers:`, error);
                this.bot.sendMessage(chatId, '❌ Gagal mengambil daftar pelanggan');
            }
        });

        // callback_query
        this.bot.on('callback_query', async (query) => {
            const chatId = query.message.chat.id;
            const data = query.data;

            this.bot.answerCallbackQuery(query.id).catch(() => {});

            const isAdmin = this.config.adminIds.includes(chatId.toString());
            const customer = this.customers?.[chatId.toString()];
            if (!isAdmin && !customer) return;

            const parts = data.split(':');
            if (parts.length < 2) return;
            const action = parts[0];
            const searchTerm = parts[1];

            if (!isAdmin && customer && searchTerm !== customer.deviceSN) return;

            try {
                if (action === 'wifi') {
                    const device = await this.findDevice(searchTerm);
                    if (!device) return this.bot.sendMessage(chatId, '❌ Device tidak ditemukan');
                    const message = this.formatWiFiStatus(device, searchTerm);
                    const keyboard = this.getWiFiInlineKeyboard(device, searchTerm);
                    await this.bot.sendMessage(chatId, message, {
                        parse_mode: 'HTML',
                        reply_markup: keyboard
                    });
                } 
                else if (action === 'edit_ssid' || action === 'edit_pass') {
                    const index = parts[2] || '1';
                    const bandInfo = this.getBandDescription(index);
                    const actionType = action === 'edit_ssid' ? 'set_ssid' : 'set_pass';
                    
                    this.userSessions[chatId.toString()] = {
                        action: actionType,
                        searchTerm: searchTerm,
                        index: index,
                        expiresAt: Date.now() + 120000 // 2 menit timeout
                    };

                    if (action === 'edit_ssid') {
                        await this.bot.sendMessage(chatId,
                            `✏️ <b>Ubah Nama WiFi - ${this.escapeHtml(bandInfo)}</b>\n\n` +
                            `Perangkat: <code>${this.escapeHtml(searchTerm)}</code>\n` +
                            `Silakan ketik <b>Nama WiFi (SSID) baru</b> di chat:\n\n` +
                            `<i>(Ketik /cancel untuk membatalkan)</i>`,
                            { parse_mode: 'HTML' }
                        );
                    } else {
                        await this.bot.sendMessage(chatId,
                            `🔑 <b>Ubah Password WiFi - ${this.escapeHtml(bandInfo)}</b>\n\n` +
                            `Perangkat: <code>${this.escapeHtml(searchTerm)}</code>\n` +
                            `Silakan ketik <b>Password baru</b> (minimal 8 karakter) di chat:\n\n` +
                            `<i>(Ketik /cancel untuk membatalkan)</i>`,
                            { parse_mode: 'HTML' }
                        );
                    }
                } 
                else if (action === 'reboot' && isAdmin) {
                    await this.bot.sendMessage(chatId, `⏳ <b>Rebooting ${this.escapeHtml(searchTerm)}...</b>`, { parse_mode: 'HTML' });
                    await this.rebootDevice(searchTerm);
                    await this.bot.sendMessage(chatId, '✅ <b>Perintah sukses dikirim</b>', { parse_mode: 'HTML' });
                }
                else if (action === 'users' && isAdmin) {
                    const device = await this.findDevice(searchTerm);
                    if (!device) return this.bot.sendMessage(chatId, '❌ Device tidak ditemukan');
                    const activeDevices = this.getDeviceActiveUsers(device);
                    await this.bot.sendMessage(chatId, `👥 <b>User Aktif</b>: <code>${this.escapeHtml(activeDevices)}</code>`, { parse_mode: 'HTML' });
                }
                else if (action === 'signal' && isAdmin) {
                    const device = await this.findDevice(searchTerm);
                    if (!device) return this.bot.sendMessage(chatId, '❌ Device tidak ditemukan');
                    const rxPower = this.getDeviceRxPower(device);
                    await this.bot.sendMessage(chatId, `📶 <b>Signal RX</b>: <code>${this.escapeHtml(rxPower)} dBm</code>`, { parse_mode: 'HTML' });
                }
            } catch (error) {
                console.error(`[${this.name}] Callback Error:`, error);
                this.bot.sendMessage(chatId, `❌ Gagal memproses ${action}`);
            }
        });

        // Polling error handler
        this.bot.on('polling_error', (error) => {
            console.error(`[${Date.now()}] Polling error:`, error.message);
            if (error.code === 'ETELEGRAM' && error.response?.body) {
                console.error(`[${Date.now()}] Telegram API Error:`, error.response.body);
            }
        });
    }

    async getDevicesFromGenieACS() {
        console.log(`[${Date.now()}] Getting devices from GenieACS...`);
        try {
            // Projection query to retrieve only essential parameters for fast payload
            const projection = '_id,_deviceId,VirtualParameters,InternetGatewayDevice,Device,Events,_lastInform';
            const url = `${this.config.genieacs.baseUrl}/devices?projection=${projection}`;
            console.log(`[${Date.now()}] Requesting URL: ${url}`);
            console.log(`[${Date.now()}] Auth User: ${this.config.genieacs.username}`);
            
            const response = await axios.get(url, {
                auth: {
                    username: this.config.genieacs.username,
                    password: this.config.genieacs.password
                },
                timeout: 10000
            });

            console.log(`[${Date.now()}] Got response from GenieACS (Devices: ${response.data.length})`);
            return response.data;
        } catch (error) {
            console.error(`[${Date.now()}] Error getting devices:`, error.message);
            if (error.response) {
                console.error(`[${Date.now()}] Response status:`, error.response.status);
            }
            throw error;
        }
    }

    async findDevice(searchTerm) {
        if (!searchTerm) return null;
        const devices = await this.getDevicesFromGenieACS();
        const term = searchTerm.trim();
        for (const device of devices) {
            const sn = this.getDeviceSerialNumber(device);
            const pppoeUser = this.getDevicePPPoEUsername(device);
            const deviceInfo = device._deviceId || {};
            
            if (pppoeUser === term ||
                sn === term ||
                deviceInfo._SerialNumber === term ||
                device._id === term) {
                return device;
            }
        }
        return null;
    }

    async getDeviceInfo(searchTerm) {
        try {
            return await this.findDevice(searchTerm);
        } catch (error) {
            console.error(`[${this.name}] Error getting device info:`, error);
            throw error;
        }
    }

    async rebootDevice(searchTerm) {
        try {
            const device = await this.findDevice(searchTerm);
            if (!device) throw new Error('Device not found');
            
            const response = await axios.post(
                `${this.config.genieacs.baseUrl}/devices/${encodeURIComponent(device._id)}/tasks?connection_request`,
                {
                    name: 'reboot',
                    device: device._id
                },
                {
                    auth: {
                        username: this.config.genieacs.username,
                        password: this.config.genieacs.password
                    }
                }
            );
            return response.data;
        } catch (error) {
            console.error(`[${this.name}] Error rebooting device:`, error);
            throw error;
        }
    }

    async setWiFiPassword(searchTerm, password, index = 1) {
        try {
            const device = await this.findDevice(searchTerm);
            if (!device) throw new Error('Device not found');
            
            const wlanIndex = String(index || 1);
            
            const response = await axios.post(
                `${this.config.genieacs.baseUrl}/devices/${encodeURIComponent(device._id)}/tasks?connection_request`,
                {
                    name: 'setParameterValues',
                    parameterValues: [
                        [`InternetGatewayDevice.LANDevice.1.WLANConfiguration.${wlanIndex}.KeyPassphrase`, password, 'xsd:string'],
                        [`InternetGatewayDevice.LANDevice.1.WLANConfiguration.${wlanIndex}.PreSharedKey.1.PreSharedKey`, password, 'xsd:string']
                    ]
                },
                {
                    auth: {
                        username: this.config.genieacs.username,
                        password: this.config.genieacs.password
                    },
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }
            );
            return response.data;
        } catch (error) {
            console.error(`[${this.name}] Error setting WiFi password (Index ${index}):`, error);
            throw error;
        }
    }

    async setWANCredentials(searchTerm, username, password) {
        try {
            const device = await this.findDevice(searchTerm);
            if (!device) throw new Error('Device not found');
            
            const response = await axios.post(
                `${this.config.genieacs.baseUrl}/devices/${encodeURIComponent(device._id)}/tasks?connection_request`,
                {
                    name: 'setParameterValues',
                    parameterValues: [
                        ['InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username', username, 'xsd:string'],
                        ['InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Password', password, 'xsd:string']
                    ]
                },
                {
                    auth: {
                        username: this.config.genieacs.username,
                        password: this.config.genieacs.password
                    }
                }
            );
            return response.data;
        } catch (error) {
            console.error(`[${this.name}] Error setting WAN credentials:`, error);
            throw error;
        }
    }

    async setWiFiSSID(searchTerm, ssid, index = 1) {
        try {
            const device = await this.findDevice(searchTerm);
            if (!device) throw new Error('Device not found');
            
            const wlanIndex = String(index || 1);
            
            const response = await axios.post(
                `${this.config.genieacs.baseUrl}/devices/${encodeURIComponent(device._id)}/tasks?connection_request`,
                {
                    name: 'setParameterValues',
                    parameterValues: [
                        [`InternetGatewayDevice.LANDevice.1.WLANConfiguration.${wlanIndex}.SSID`, ssid, 'xsd:string']
                    ]
                },
                {
                    auth: {
                        username: this.config.genieacs.username,
                        password: this.config.genieacs.password
                    },
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }
            );

            return response.data;
        } catch (error) {
            console.error(`[${Date.now()}] Error setting WiFi SSID (Index ${index}):`, error);
            throw error;
        }
    }

    async sendLongMessage(chatId, message, options = {}) {
        const MAX_LENGTH = 3900;
        
        if (message.length <= MAX_LENGTH) {
            return await this.bot.sendMessage(chatId, message, options);
        }

        const parts = message.split('\n');
        let currentMessage = '';

        for (const part of parts) {
            if ((currentMessage + part + '\n').length > MAX_LENGTH) {
                if (currentMessage) {
                    await this.bot.sendMessage(chatId, currentMessage, options);
                }
                currentMessage = part + '\n';
            } else {
                currentMessage += part + '\n';
            }
        }

        if (currentMessage) {
            await this.bot.sendMessage(chatId, currentMessage, options);
        }
    }
}

module.exports = GenieACSBot;
