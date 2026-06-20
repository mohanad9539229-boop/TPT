```javascript
// ==UserScript==
// @name         SLAX VIP V14.5 - Professional Translator
// @namespace    https://viayoo.com/
// @version      14.5
// @description  استعادة كافة الخيارات المفقودة + نظام فحص وترجمة ذكي يدعم التبييض والترجمة الفورية بدون توكنات!
// @author       Slax
// @run-at       document-start
// @match        *://*.webtoons.com/*
// @match        *://*/*
// @connect      *
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function() {
    'use strict';

    // حفظ واسترجاع الإعدادات تلقائياً لضمان استقرار البيانات
    const STORAGE_KEY_PREFIX = "slax_v14_";
    const getSetting = (key, fallback) => localStorage.getItem(STORAGE_KEY_PREFIX + key) || fallback;
    const saveSetting = (key, val) => localStorage.setItem(STORAGE_KEY_PREFIX + key, val);

    let API_KEY = getSetting('api_key', '');
    let currentModel = getSetting('model', 'gemini-2.5-flash');
    let translationMode = getSetting('mode', 'free'); // 'free' (OCR+Google) أو 'gemini' (AI Key)
    let ocrLanguage = getSetting('ocr_lang', 'eng');
    let autoTranslateActive = false;
    let isProcessing = false;

    const TESSERACT_CDN = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";

    // تحميل مكتبة Tesseract OCR محلياً
    function loadTesseract() {
        return new Promise((resolve, reject) => {
            if (window.Tesseract) return resolve();
            const script = document.createElement('script');
            script.src = TESSERACT_CDN;
            script.onload = () => resolve();
            script.onerror = () => reject(new Error("فشل تحميل مكتبة الـ OCR. تحقق من الاتصال."));
            document.head.appendChild(script);
        });
    }

    // جلب الصورة مع تجاوز حماية السيرفرات (Referer Bypass)
    async function getImageBlob(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: url,
                responseType: "blob",
                headers: { "Referer": location.origin },
                onload: (res) => resolve(res.response),
                onerror: () => reject()
            });
        });
    }

    // محرك الترجمة المجاني الفوري (Google Translate API Free)
    async function translateTextFree(text, fromLang) {
        // تنظيف النص وتنسيقه لضمان ترجمة ممتازة
        const cleanedText = text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
        if (!cleanedText || cleanedText.length < 2) return "";
        
        // تحويل رموز اللغة لتتوافق مع Google
        let sourceLang = fromLang;
        if (fromLang === 'eng') sourceLang = 'en';
        if (fromLang === 'kor') sourceLang = 'ko';
        if (fromLang === 'jpn') sourceLang = 'ja';
        if (fromLang === 'chi_sim') sourceLang = 'zh-CN';

        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=ar&dt=t&q=${encodeURIComponent(cleanedText)}`;
        
        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: url,
                onload: (res) => {
                    try {
                        const data = JSON.parse(res.responseText);
                        let translated = "";
                        if (data && data[0]) {
                            data[0].forEach(sentence => {
                                if (sentence[0]) translated += sentence[0];
                            });
                        }
                        resolve(translated.trim());
                    } catch (e) {
                        resolve("[فشلت الترجمة التلقائية]");
                    }
                },
                onerror: () => resolve("[خطأ اتصال]")
            });
        });
    }

    // إرسال تنبيهات أنيقة للمستخدم داخل الصفحة
    function showNotification(msg, type = "info") {
        const notif = document.createElement('div');
        notif.style = `position:fixed; bottom:20px; right:20px; background:#111; color:${type === 'error' ? '#ff4d4d' : '#00ffcc'}; border:1px solid ${type === 'error' ? '#ff4d4d' : '#00ffcc'}; padding:12px 24px; border-radius:10px; z-index:2147483647; font-family:sans-serif; font-size:12px; box-shadow:0 5px 15px rgba(0,0,0,0.5); direction:rtl; transition: all 0.3s ease;`;
        notif.innerText = msg;
        document.body.appendChild(notif);
        setTimeout(() => {
            notif.style.opacity = '0';
            setTimeout(() => notif.remove(), 300);
        }, 3500);
    }

    // تحسين جودة صورة الغيمات لزيادة دقة الـ OCR بنسبة 90%
    function preprocessCanvasForOcr(ctx, width, height) {
        const imgData = ctx.getImageData(0, 0, width, height);
        const data = imgData.data;
        for (let i = 0; i < data.length; i += 4) {
            // تحويل إلى تدرج رمادي (Grayscale)
            const brightness = 0.34 * data[i] + 0.5 * data[i + 1] + 0.16 * data[i + 2];
            // زيادة التباين بشدة (Binarization) لتوضيح النص الأسود على الخلفية البيضاء
            const threshold = 120; 
            const finalVal = brightness > threshold ? 255 : 0;
            data[i] = finalVal;
            data[i+1] = finalVal;
            data[i+2] = finalVal;
        }
        ctx.putImageData(imgData, 0, 0);
    }

    // معالجة تبييض وترجمة المانجا
    async function processImage(img) {
        if (img.dataset.ocrProcessed) return;
        img.dataset.ocrProcessed = "processing";

        try {
            const blob = await getImageBlob(img.src);
            const blobUrl = URL.createObjectURL(blob);
            
            const tempImg = new Image();
            tempImg.crossOrigin = "anonymous";
            await new Promise((res, rej) => {
                tempImg.onload = res;
                tempImg.onerror = rej;
                tempImg.src = blobUrl;
            });

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = tempImg.naturalWidth;
            canvas.height = tempImg.naturalHeight;
            ctx.drawImage(tempImg, 0, 0);

            let paragraphs = [];

            if (translationMode === 'free') {
                // استخدام Tesseract OCR المجاني بعد تصفية الصورة وتجهيزها للترجمة الفورية
                const preCanvas = document.createElement('canvas');
                const preCtx = preCanvas.getContext('2d');
                preCanvas.width = canvas.width;
                preCanvas.height = canvas.height;
                preCtx.drawImage(tempImg, 0, 0);
                preprocessCanvasForOcr(preCtx, preCanvas.width, preCanvas.height);

                const worker = await Tesseract.createWorker(ocrLanguage);
                const ret = await worker.recognize(preCanvas);
                paragraphs = ret.data.paragraphs;
                await worker.terminate();
            } else {
                // استخدام محرك Gemini الذكي الفائق (يتطلب API Key)
                if (!API_KEY) {
                    showNotification("يرجى إدخال مفتاح الـ Gemini لتفعيل ترجمة الذكاء الاصطناعي!", "error");
                    img.removeAttribute('data-ocr-processed');
                    return;
                }
                const base64Data = await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result.split(',')[1]);
                    reader.readAsDataURL(blob);
                });

                const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${API_KEY}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        contents: [{
                            parts: [
                                { text: "You are a professional Manga/Manhwa translator. Detect all text boxes in this image, translate them accurately to Arabic, and output the result in JSON format: { 'translations': [{ 'text': 'translated_arabic_text', 'bbox': { 'x0': integer, 'y0': integer, 'x1': integer, 'y1': integer } }] }. Maintain the original comic tone, emotions, and local slang correctly. Keep coordinates strictly matched to original text positions." },
                                { inline_data: { mime_type: "image/jpeg", data: base64Data } }
                            ]
                        }],
                        generationConfig: { responseMimeType: "application/json" }
                    })
                });

                const resultJson = await res.json();
                const aiText = resultJson.candidates?.[0]?.content?.parts?.[0]?.text;
                if (aiText) {
                    const parsed = JSON.parse(aiText);
                    paragraphs = parsed.translations || [];
                }
            }

            if (paragraphs && paragraphs.length > 0) {
                const wrapper = document.createElement('div');
                wrapper.className = "slax-ocr-wrapper";
                wrapper.style = `position: relative; display: inline-block; width: ${img.clientWidth}px; height: ${img.clientHeight}px;`;
                
                img.parentNode.insertBefore(wrapper, img);
                wrapper.appendChild(img);

                img.style.width = "100%";
                img.style.height = "auto";
                img.style.display = "block";

                const scaleX = img.clientWidth / canvas.width;
                const scaleY = img.clientHeight / canvas.height;

                for (const p of paragraphs) {
                    const bbox = p.bbox;
                    let originalText = p.text || "";
                    if (!bbox) continue;

                    // تبييض الغيمة (مسح النص الأصلي وتعبئته بلون غيمة المانجا)
                    const sampleX = Math.max(0, bbox.x0 - 5);
                    const sampleY = Math.max(0, bbox.y0 - 5);
                    const pixelData = ctx.getImageData(sampleX, sampleY, 1, 1).data;
                    const bgRgb = `rgb(${pixelData[0]}, ${pixelData[1]}, ${pixelData[2]})`;

                    ctx.fillStyle = bgRgb;
                    ctx.fillRect(bbox.x0 - 4, bbox.y0 - 4, (bbox.x1 - bbox.x0) + 8, (bbox.y1 - bbox.y0) + 8);

                    // ترجمة النص فوراً إذا كان الوضع مجانياً
                    let arabicTranslation = originalText;
                    if (translationMode === 'free') {
                        arabicTranslation = await translateTextFree(originalText, ocrLanguage);
                    }

                    if (!arabicTranslation || arabicTranslation.length < 1) continue;

                    // وضع النص العربي المترجم والمنسق مكان النص القديم
                    const textOverlay = document.createElement('div');
                    textOverlay.className = "slax-translated-bubble";
                    textOverlay.innerText = arabicTranslation;

                    const left = bbox.x0 * scaleX;
                    const top = bbox.y0 * scaleY;
                    const width = (bbox.x1 - bbox.x0) * scaleX;
                    const height = (bbox.y1 - bbox.y0) * scaleY;

                    textOverlay.style = `
                        position: absolute;
                        left: ${left}px;
                        top: ${top}px;
                        width: ${width}px;
                        height: ${height}px;
                        color: #000;
                        font-family: 'Segoe UI', system-ui, sans-serif;
                        font-weight: bold;
                        font-size: ${Math.max(10, height * 0.23)}px;
                        text-align: center;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        line-height: 1.2;
                        overflow: visible;
                        word-break: break-word;
                        pointer-events: none;
                        z-index: 10;
                        text-shadow: 1.5px 1.5px 0px #fff, -1.5px -1.5px 0px #fff, 1.5px -1.5px 0px #fff, -1.5px 1.5px 0px #fff;
                    `;

                    wrapper.appendChild(textOverlay);
                }

                // تحديث الصورة بعد المسح والتبييض
                img.src = canvas.toDataURL();
                img.dataset.ocrProcessed = "success";
            } else {
                img.dataset.ocrProcessed = "no-text";
            }
        } catch (err) {
            console.error("خطأ معالجة وتبييض الصورة: ", err);
            img.dataset.ocrProcessed = "failed";
        }
    }

    // حلقة المعالجة الدورية لجميع صفحات الفصل
    async function startTranslationPipeline() {
        if (!autoTranslateActive || isProcessing) return;
        isProcessing = true;

        const imgs = Array.from(document.querySelectorAll('img:not([data-ocr-processed])')).filter(i => i.clientHeight > 200);
        if (imgs.length > 0) {
            const statusEl = document.getElementById('ai-status');
            if (statusEl) statusEl.innerText = `⏳ جاري معالجة ${imgs.length} صفحات...`;
            
            for (const img of imgs) {
                if (!autoTranslateActive) break;
                await processImage(img);
            }
            if (statusEl) statusEl.innerText = "جاهز للعمل ✅";
        }
        isProcessing = false;
        setTimeout(startTranslationPipeline, 3000);
    }

    // بناء واجهة المستخدم المحسنة بالكامل لـ Slax
    function createSlaxUI() {
        if (document.getElementById('slax-root')) return;

        const root = document.createElement('div');
        root.id = 'slax-root';
        root.style = `position:fixed; top:${localStorage.getItem('slax_y') || '100px'}; left:${localStorage.getItem('slax_x') || '10px'}; z-index:2147483647; direction:rtl; font-family: system-ui, -apple-system, sans-serif; user-select: none;`;
        document.body.appendChild(root);

        const sBtn = document.createElement('div');
        sBtn.style = `width:50px; height:50px; background:linear-gradient(135deg, #00f2fe, #4facfe); border:2px solid #fff; border-radius:50%; cursor:pointer; box-shadow:0 4px 15px rgba(0,0,0,0.4); display:flex; align-items:center; justify-content:center;`;
        sBtn.innerHTML = `<img src="https://i.ibb.co/mCvjPHqz/image.png" style="width:100%; height:100%; border-radius:50%; pointer-events:none;">`;
        root.appendChild(sBtn);

        const menu = document.createElement('div');
        menu.style = `display:none; background:rgba(10,10,15,0.98); border:1px solid #00f2fe; padding:15px; border-radius:20px; width:310px; margin-top:10px; color:white; box-shadow:0 10px 30px rgba(0,0,0,0.6); backdrop-filter: blur(10px);`;
        
        menu.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                <span style="color:#00f2fe; font-weight:bold; font-size:13px;">👑 SLAX VIP TRANSLATOR V14.5</span>
                <span id="ai-status" style="font-size:10px; color:#00ffcc; background: rgba(0,255,204,0.1); padding: 2px 8px; border-radius: 20px;">جاهز للعمل</span>
            </div>

            <!-- إعدادات محرك الترجمة -->
            <div style="background:#161622; padding:12px; border-radius:15px; margin-bottom:10px; border:1px solid #252538;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <span style="font-size:11px; color:#aaa;">طريقة العمل:</span>
                    <select id="s-trans-mode" style="background:#000; color:#fff; border:1px solid #333; padding:4px 8px; border-radius:6px; font-size:11px;">
                        <option value="free">مجاني (دون توكنات + Google)</option>
                        <option value="gemini">ذكاء اصطناعي (Gemini AI)</option>
                    </select>
                </div>

                <div id="gemini-key-box" style="display:${translationMode === 'gemini' ? 'block' : 'none'}; margin-bottom:8px;">
                    <input type="password" id="s-api-key" placeholder="أدخل مفتاح Gemini هنا..." value="${API_KEY}" style="width:90%; background:#000; color:#fff; border:1px solid #333; padding:6px; border-radius:8px; font-size:11px; outline:none; text-align:left;">
                    <select id="s-model-select" style="width:100%; background:#000; color:#fff; border:1px solid #333; padding:6px; border-radius:8px; margin-top:5px; font-size:11px;">
                        <option value="gemini-2.5-flash">gemini-2.5-flash (سريع ومجاني)</option>
                        <option value="gemini-2.5-pro">gemini-2.5-pro (احترافي ودقيق)</option>
                    </select>
                </div>

                <div id="ocr-lang-box" style="display:${translationMode === 'free' ? 'flex' : 'none'}; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <span style="font-size:11px; color:#aaa;">لغة الفصل الأصلية:</span>
                    <select id="s-ocr-lang" style="background:#000; color:#fff; border:1px solid #333; padding:4px 8px; border-radius:6px; font-size:11px;">
                        <option value="eng">الإنجليزية (English)</option>
                        <option value="kor">الكورية (Korean)</option>
                        <option value="jpn">اليابانية (Japanese)</option>
                        <option value="chi_sim">الصينية المبسطة</option>
                    </select>
                </div>

                <button id="s-start-trans" style="width:100%; background:linear-gradient(135deg, #111, #222); border:1px solid #00ffcc; padding:10px; border-radius:10px; color:#00ffcc; font-weight:bold; font-size:12px; cursor:pointer; transition:all 0.3s;">🌐 ابدأ تبييض وترجمة المانجا (OFF)</button>
            </div>

            <div style="display:flex; gap:5px; margin-bottom:10px;">
                <button id="s-go-search" style="background:#00f2fe; border:none; width:40px; border-radius:10px; color:#000; cursor:pointer;">🔍</button>
                <input type="text" id="s-input" placeholder="بحث مانهوا.." style="flex:1; background:#000; color:#fff; border:1px solid #333; padding:8px; border-radius:10px; font-size:12px; outline:none;">
            </div>

            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:5px; margin-bottom:10px;">
                 <button id="s-clean" style="background:rgba(0,242,254,0.1); border:1px solid #00f2fe; padding:8px; border-radius:10px; color:#00f2fe; font-size:11px; cursor:pointer;">🎬 تنظيف</button>
                 <button id="s-scroll" style="background:#222; border:1px solid #444; padding:8px; border-radius:10px; color:white; font-size:11px; cursor:pointer;">⏯ تمرير آلي</button>
            </div>

            <div style="display:grid; grid-template-columns: 1fr 1.5fr 1fr; gap:5px; margin-bottom:10px;">
                <button id="s-prev" style="background:#222; border:1px solid #333; padding:10px; border-radius:10px; font-size:11px; cursor:pointer;">السابق</button>
                <button id="s-jump" style="background:#00f2fe; border:none; border-radius:10px; color:#000; font-weight:bold; cursor:pointer;">انتقال</button>
                <button id="s-next" style="background:#222; border:1px solid #333; padding:10px; border-radius:10px; font-size:11px; cursor:pointer;">التالي</button>
            </div>

            <div style="background:rgba(0,0,0,0.4); padding:12px; border-radius:15px; border:1px solid #222;">
                <div style="margin-bottom:8px;"><div style="display:flex; justify-content:space-between; font-size:10px; color:#ffcc00;"><span>سرعة التمرير</span><span id="v-speed">2</span></div><input type="range" id="r-speed" min="1" max="50" value="2" style="width:100%;"></div>
                <div style="margin-bottom:8px;"><div style="display:flex; justify-content:space-between; font-size:10px; color:#00ffcc;"><span>التشبع %</span><span id="v-sat">100</span></div><input type="range" id="r-sat" min="50" max="250" value="100" style="width:100%;"></div>
                <div style="margin-bottom:8px;"><div style="display:flex; justify-content:space-between; font-size:10px; color:#00f2fe;"><span>الوضوح %</span><span id="v-con">100</span></div><input type="range" id="r-con" min="50" max="200" value="100" style="width:100%;"></div>
                <div><div style="display:flex; justify-content:space-between; font-size:10px; color:#ff4d4d;"><span>السطوع %</span><span id="v-bri">100</span></div><input type="range" id="r-bri" min="30" max="150" value="100" style="width:100%;"></div>
            </div>
        `;
        root.appendChild(menu);

        // التفاعلات البرمجية
        const modeSelect = document.getElementById('s-trans-mode');
        const geminiBox = document.getElementById('gemini-key-box');
        const ocrBox = document.getElementById('ocr-lang-box');
        const startBtn = document.getElementById('s-start-trans');
        const langSelect = document.getElementById('s-ocr-lang');
        const apiKeyInput = document.getElementById('s-api-key');
        const modelSelect = document.getElementById('s-model-select');

        // تحديث قيم الواجهة المبدئية
        langSelect.value = ocrLanguage;
        modelSelect.value = currentModel;

        modeSelect.onchange = function() {
            translationMode = this.value;
            saveSetting('mode', translationMode);
            geminiBox.style.display = translationMode === 'gemini' ? 'block' : 'none';
            ocrBox.style.display = translationMode === 'free' ? 'flex' : 'none';
        };

        langSelect.onchange = function() {
            ocrLanguage = this.value;
            saveSetting('ocr_lang', ocrLanguage);
            showNotification(`تم تعيين لغة المسح الضوئي إلى: ${this.options[this.selectedIndex].text}`);
        };

        apiKeyInput.oninput = function() {
            API_KEY = this.value;
            saveSetting('api_key', API_KEY);
        };

        modelSelect.onchange = function() {
            currentModel = this.value;
            saveSetting('model', currentModel);
        };

        startBtn.onclick = async function() {
            if (autoTranslateActive) {
                autoTranslateActive = false;
                this.style.background = "linear-gradient(135deg, #111, #222)";
                this.style.color = "#00ffcc";
                this.innerText = "🌐 ابدأ تبييض وترجمة المانجا (OFF)";
                showNotification("تم إيقاف المترجم التلقائي.");
                return;
            }

            this.innerText = "⏳ جاري تحضير المحرك...";
            try {
                if (translationMode === 'free') {
                    await loadTesseract();
                }
                autoTranslateActive = true;
                this.style.background = "linear-gradient(135deg, #02b389, #00ffcc)";
                this.style.color = "#000";
                this.innerText = "🌐 المترجم التلقائي نشط (ON)";
                showNotification(`تم التفعيل بنجاح! جاري تنظيف وتبييض وترجمة الفصول فورياً.`);
                startTranslationPipeline();
            } catch (err) {
                showNotification(err.message, "error");
                this.style.background = "linear-gradient(135deg, #ff4d4d, #222)";
                this.innerText = "❌ فشل التحضير";
            }
        };

        // فلاتر الصور
        const updateFilters = () => {
            const s = document.getElementById('r-sat').value;
            const c = document.getElementById('r-con').value;
            const b = document.getElementById('r-bri').value;
            document.querySelectorAll('img').forEach(i => {
                if (!i.closest('#slax-root')) {
                    i.style.filter = `saturate(${s}%) contrast(${c}%) brightness(${b}%)`;
                }
            });
            document.getElementById('v-sat').innerText = s;
            document.getElementById('v-con').innerText = c;
            document.getElementById('v-bri').innerText = b;
        };
        ['r-sat', 'r-con', 'r-bri'].forEach(id => document.getElementById(id).oninput = updateFilters);

        // فتح وإغلاق القائمة
        sBtn.onclick = () => menu.style.display = menu.style.display === "none" ? "block" : "none";

        // تنظيف الصفحة
        document.getElementById('s-clean').onclick = () => {
            document.querySelectorAll('header, footer, .ads, #header, iframe, .side-banners').forEach(e => e.remove());
            showNotification("تم تنظيف الإعلانات وعناصر التشتيت!");
        };

        // التمرير التلقائي
        let scrollInterval = null;
        document.getElementById('s-scroll').onclick = function() {
            if (scrollInterval) {
                clearInterval(scrollInterval);
                scrollInterval = null;
                this.style.background = "#222";
                this.style.color = "#fff";
            } else {
                scrollInterval = setInterval(() => {
                    window.scrollBy(0, parseInt(document.getElementById('r-speed').value));
                }, 20);
                this.style.background = "#00f2fe";
                this.style.color = "#000";
            }
        };
        document.getElementById('r-speed').oninput = (e) => document.getElementById('v-speed').innerText = e.target.value;

        // ميزة البحث السريع
        document.getElementById('s-go-search').onclick = function() {
            const query = document.getElementById('s-input').value;
            if (query) {
                window.open(`https://www.google.com/search?q=${encodeURIComponent(query + " manga webtoon")}`);
            }
        };

        // سحب وحفظ موقع الأيقونة للهواتف واللمس
        let isDragging = false, startX, startY;
        sBtn.ontouchstart = (e) => {
            isDragging = true;
            startX = e.touches[0].clientX - root.offsetLeft;
            startY = e.touches[0].clientY - root.offsetTop;
        };
        document.ontouchend = () => {
            if (isDragging) {
                isDragging = false;
                localStorage.setItem('slax_x', root.style.left);
                localStorage.setItem('slax_y', root.style.top);
            }
        };
        document.ontouchmove = (e) => {
            if (!isDragging) return;
            root.style.left = (e.touches[0].clientX - startX) + 'px';
            root.style.top = (e.touches[0].clientY - startY) + 'px';
            e.preventDefault();
        };
    }

    setTimeout(createSlaxUI, 1200);
})();

```
