```javascript
// ==UserScript==
// @name         SLAX VIP V15.5 - Hyper Fast Red OCR & Translator
// @namespace    https://viayoo.com/
// @version      15.5
// @description  تبييض فوري فائق السرعة، ترجمة ذكية ومستقرة بطلب واحد لكل صفحة، خطوط ديناميكية متناسقة، واجهة زجاجية حمراء داكنة فاخرة.
// @author       Slax
// @run-at       document-start
// @match        *://*.webtoons.com/*
// @match        *://*/*
// @connect      *
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function() {
    'use strict';

    // تهيئة نظام التخزين المحلي لبيانات Slax
    const STORAGE_PREFIX = "slax_v15_5_";
    const getSetting = (key, fallback) => localStorage.getItem(STORAGE_PREFIX + key) || fallback;
    const saveSetting = (key, val) => localStorage.setItem(STORAGE_PREFIX + key, val);

    let API_KEY = getSetting('api_key', '');
    let currentModel = getSetting('model', 'gemini-2.5-flash');
    let translationMode = getSetting('mode', 'free'); // 'free' أو 'gemini'
    let ocrLanguage = getSetting('ocr_lang', 'eng');
    let autoTranslateActive = false;
    let isProcessing = false;

    // محرك نصوص موحد لمنع التكرار والتعليق
    let globalTesseractWorker = null;

    const TESSERACT_CDN = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
    const ICON_URL = "https://i.ibb.co/nMBFJ7kV/image.png";

    // تحميل مكتبة التعرف على النصوص وتشغيل محرك موحد لمرة واحدة فقط
    async function initGlobalTesseract() {
        if (globalTesseractWorker) return;
        
        if (!window.Tesseract) {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = TESSERACT_CDN;
                script.onload = () => resolve();
                script.onerror = () => reject(new Error("فشل تحميل مكتبة الترجمة. تحقق من اتصالك بالإنترنت."));
                document.head.appendChild(script);
            });
        }
        
        // إنشاء محرك واحد ثابت لتسريع المعالجة 10 أضعاف
        globalTesseractWorker = await Tesseract.createWorker(ocrLanguage);
    }

    // تدمير المحرك عند الإيقاف لتحرير الذاكرة
    async function terminateGlobalTesseract() {
        if (globalTesseractWorker) {
            await globalTesseractWorker.terminate();
            globalTesseractWorker = null;
        }
    }

    // جلب الصور متجاوزاً حماية السيرفرات لضمان عدم فشل التبييض
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

    // ترجمة حزمة نصوص كاملة بطلب واحد ذكي لمنع الحظر والبطء
    async function translateTextBundle(textsArray, fromLang) {
        if (!textsArray || textsArray.length === 0) return [];

        // تنظيف النصوص ودمجها بفواصل فريدة لا تغيرها Google
        const cleanedTexts = textsArray.map(t => t.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim());
        const combinedText = cleanedTexts.join('\n {SLX} \n');
        
        let sourceLang = fromLang === 'eng' ? 'en' : (fromLang === 'kor' ? 'ko' : (fromLang === 'jpn' ? 'ja' : 'zh-CN'));
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=ar&dt=t&q=${encodeURIComponent(combinedText)}`;
        
        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: url,
                onload: (res) => {
                    try {
                        const data = JSON.parse(res.responseText);
                        let translatedCombined = "";
                        if (data && data[0]) {
                            data[0].forEach(s => { if (s[0]) translatedCombined += s[0]; });
                        }
                        
                        // تفكيك النصوص المترجمة بناءً على الفواصل الفريدة بدقة
                        const splitPattern = /\s*\{\s*SLX\s*\}\s*|\s*\{\s*slx\s*\}\s*/gi;
                        const translatedParts = translatedCombined.split(splitPattern).map(p => p.trim());
                        
                        resolve(translatedParts);
                    } catch (e) {
                        resolve(Array(textsArray.length).fill(""));
                    }
                },
                onerror: () => resolve(Array(textsArray.length).fill(""))
            });
        });
    }

    // نظام الإشعارات الزجاجي المتناسق مع التصميم الجديد
    function showNotification(msg, type = "info") {
        const notif = document.createElement('div');
        notif.style = `
            position:fixed; bottom:20px; right:20px; 
            background:rgba(25, 4, 4, 0.9); 
            color:${type === 'error' ? '#ff4d4d' : '#ff3333'}; 
            border:1.5px solid #ff1a1a; 
            padding:12px 24px; border-radius:16px; 
            z-index:2147483647; font-family:sans-serif; font-size:12px; 
            box-shadow:0 0 20px rgba(255, 0, 0, 0.4); direction:rtl; 
            transition: all 0.3s ease; backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px); font-weight: bold;
        `;
        notif.innerText = msg;
        document.body.appendChild(notif);
        setTimeout(() => {
            notif.style.opacity = '0';
            setTimeout(() => notif.remove(), 300);
        }, 3200);
    }

    // تبييض ذكي وترجمة فورية متناسقة
    async function processImage(img) {
        if (img.dataset.ocrProcessed) return;
        img.dataset.ocrProcessed = "processing";

        // إشعار مؤقت صغير يختفي فور انتهاء المعالجة السريعة
        const infoBadge = document.createElement('div');
        infoBadge.innerText = "⚡ جاري التبييض والترجمة...";
        infoBadge.style = "position:absolute; background:rgba(120,5,5,0.9); color:#fff; font-size:10px; padding:4px 8px; border-radius:6px; z-index:99; font-family:sans-serif; pointer-events:none; left:10px; top:10px; border:1px solid #ff3333; box-shadow: 0 0 10px rgba(255,0,0,0.3);";
        
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

            // تغليف الصورة بالـ Wrapper لمنع تفكك التصميم والموقع
            const wrapper = document.createElement('div');
            wrapper.className = "slax-ocr-wrapper";
            wrapper.style = `position: relative; display: inline-block; width: ${img.clientWidth}px; height: ${img.clientHeight}px;`;
            
            img.parentNode.insertBefore(wrapper, img);
            wrapper.appendChild(img);
            wrapper.appendChild(infoBadge);

            img.style.width = "100%";
            img.style.height = "auto";
            img.style.display = "block";

            const scaleX = img.clientWidth / canvas.width;
            const scaleY = img.clientHeight / canvas.height;

            let paragraphs = [];

            if (translationMode === 'free') {
                // الفحص السريع والذكي باستخدام المحرك العالمي الموحد
                if (!globalTesseractWorker) await initGlobalTesseract();
                const ret = await globalTesseractWorker.recognize(canvas);
                paragraphs = ret.data.paragraphs || [];
            } else {
                // وضع الـ Gemini الفائق
                if (!API_KEY) {
                    showNotification("الرجاء إدخال مفتاح الـ Gemini أو تشغيل الوضع المجاني السريع أولاً!", "error");
                    img.removeAttribute('data-ocr-processed');
                    infoBadge.remove();
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
                                { text: "Detect all text bubbles, translate them to Arabic, output JSON format: { 'translations': [{ 'text': 'arabic', 'bbox': { 'x0': int, 'y0': int, 'x1': int, 'y1': int } }] }." },
                                { inline_data: { mime_type: "image/jpeg", data: base64Data } }
                            ]
                        }],
                        generationConfig: { responseMimeType: "application/json" }
                    })
                });

                const resultJson = await res.json();
                const aiText = resultJson.candidates?.[0]?.content?.parts?.[0]?.text;
                if (aiText) {
                    paragraphs = JSON.parse(aiText).translations || [];
                }
            }

            if (paragraphs && paragraphs.length > 0) {
                // تجميع كافة النصوص دفعة واحدة لترجمتها بطلب واحد فقط!
                const rawTexts = paragraphs.map(p => p.text || "");
                let translatedTexts = [];

                if (translationMode === 'free') {
                    translatedTexts = await translateTextBundle(rawTexts, ocrLanguage);
                } else {
                    translatedTexts = rawTexts; // تم ترجمتها مسبقاً بواسطة الـ AI
                }

                paragraphs.forEach((p, index) => {
                    const bbox = p.bbox;
                    const arabicTranslation = translatedTexts[index];
                    if (!bbox || !arabicTranslation) return;

                    // تبييض الغيمة الذكي (أخذ عينة لونية سريعة لتلوين وتغطية النص الأصلي)
                    const sampleX = Math.min(canvas.width - 1, Math.max(0, bbox.x0 - 2));
                    const sampleY = Math.min(canvas.height - 1, Math.max(0, bbox.y0 - 2));
                    const pixelData = ctx.getImageData(sampleX, sampleY, 1, 1).data;
                    const bgRgb = `rgb(${pixelData[0]}, ${pixelData[1]}, ${pixelData[2]})`;

                    ctx.fillStyle = bgRgb;
                    ctx.fillRect(bbox.x0 - 3, bbox.y0 - 3, (bbox.x1 - bbox.x0) + 6, (bbox.y1 - bbox.y0) + 6);

                    // حساب ديناميكي متطور ومحكم لحجم خط متناسق يمنع تضخم الخطوط نهائياً
                    const width = (bbox.x1 - bbox.x0) * scaleX;
                    const height = (bbox.y1 - bbox.y0) * scaleY;
                    let calculatedFontSize = Math.min(13, Math.max(9, (height * 0.16) + (width * 0.02)));

                    const textOverlay = document.createElement('div');
                    textOverlay.className = "slax-translated-bubble";
                    textOverlay.innerText = arabicTranslation;

                    const left = bbox.x0 * scaleX;
                    const top = bbox.y0 * scaleY;

                    textOverlay.style = `
                        position: absolute;
                        left: ${left}px;
                        top: ${top}px;
                        width: ${width}px;
                        height: ${height}px;
                        color: #000;
                        font-family: system-ui, -apple-system, sans-serif;
                        font-weight: 800;
                        font-size: ${calculatedFontSize}px;
                        text-align: center;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        line-height: 1.15;
                        overflow: hidden;
                        word-break: break-word;
                        pointer-events: none;
                        z-index: 10;
                        text-shadow: 1.2px 1.2px 0px #fff, -1.2px -1.2px 0px #fff, 1.2px -1.2px 0px #fff, -1.2px 1.2px 0px #fff;
                    `;

                    wrapper.appendChild(textOverlay);
                });

                // تبييض وتحديث المانجا بشكل فوري ونهائي
                img.src = canvas.toDataURL();
                img.dataset.ocrProcessed = "success";
            } else {
                img.dataset.ocrProcessed = "no-text";
            }
        } catch (err) {
            console.error("خطأ التبييض السريع: ", err);
            img.dataset.ocrProcessed = "failed";
        } finally {
            infoBadge.remove();
        }
    }

    // أنبوب فحص وتبييض متتالٍ (صورة بصورة للحد من استهلاك الذاكرة ومنع التجميد)
    async function startTranslationPipeline() {
        if (!autoTranslateActive || isProcessing) return;
        isProcessing = true;

        const imgs = Array.from(document.querySelectorAll('img:not([data-ocr-processed])')).filter(i => i.clientHeight > 220);
        if (imgs.length > 0) {
            const statusEl = document.getElementById('ai-status');
            if (statusEl) statusEl.innerText = `🔄 معالجة ${imgs.length} صفحة...`;
            
            for (const img of imgs) {
                if (!autoTranslateActive) break;
                await processImage(img);
            }
            if (statusEl) statusEl.innerText = "نشط ⚡";
        }
        isProcessing = false;
        setTimeout(startTranslationPipeline, 1500);
    }

    // بناء الواجهة المحسنة بالكامل (تصميم أحمر داكن زجاجي متوهج)
    function createSlaxUI() {
        if (document.getElementById('slax-root')) return;

        const root = document.createElement('div');
        root.id = 'slax-root';
        root.style = `position:fixed; top:${localStorage.getItem('slax_y') || '100px'}; left:${localStorage.getItem('slax_x') || '10px'}; z-index:2147483647; direction:rtl; font-family: system-ui, -apple-system, sans-serif; user-select: none;`;
        document.body.appendChild(root);

        const sBtn = document.createElement('div');
        sBtn.style = `width:55px; height:55px; background:linear-gradient(135deg, #cc0000, #400000); border:2.5px solid #ff3333; border-radius:50%; cursor:pointer; box-shadow:0 0 20px rgba(255,0,0,0.6); display:flex; align-items:center; justify-content:center; overflow:hidden; transition: transform 0.2s;`;
        sBtn.innerHTML = `<img src="${ICON_URL}" style="width:100%; height:100%; object-fit:cover; pointer-events:none;">`;
        root.appendChild(sBtn);

        const menu = document.createElement('div');
        menu.style = `
            display:none; 
            background: rgba(18, 2, 2, 0.82); 
            border: 1.5px solid #ff1a1a; 
            padding: 16px; 
            border-radius: 24px; 
            width: 310px; 
            margin-top: 12px; 
            color: #ffe6e6; 
            box-shadow: 0 10px 35px rgba(0,0,0,0.85), inset 0 0 20px rgba(255, 0, 0, 0.25); 
            backdrop-filter: blur(15px);
            -webkit-backdrop-filter: blur(15px);
        `;
        
        menu.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; border-bottom:1.5px solid rgba(255,26,26,0.35); padding-bottom:8px;">
                <span style="color:#ff3333; font-weight:bold; font-size:13px; text-shadow:0 0 8px rgba(255,51,51,0.6);">👑 SLAX FAST OCR V15.5</span>
                <span id="ai-status" style="font-size:10px; color:#ff3333; background: rgba(255,0,0,0.18); padding: 3px 10px; border-radius: 20px; font-weight:bold; border:0.5px solid rgba(255,26,26,0.4);">جاهز للعمل</span>
            </div>

            <!-- لوحة الترجمة الفورية -->
            <div style="background:rgba(35, 4, 4, 0.7); padding:12px; border-radius:16px; margin-bottom:10px; border:1px solid rgba(255,26,26,0.25);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                    <span style="font-size:11px; color:#ff8080;">طريقة الترجمة:</span>
                    <select id="s-trans-mode" style="background:#150202; color:#ffe6e6; border:1px solid #ff3333; padding:4px 8px; border-radius:8px; font-size:11px; outline:none; cursor:pointer;">
                        <option value="free">مجاني (دون توكنات + سريع)</option>
                        <option value="gemini">ذكاء اصطناعي (Gemini AI)</option>
                    </select>
                </div>

                <div id="gemini-key-box" style="display:${translationMode === 'gemini' ? 'block' : 'none'}; margin-bottom:10px;">
                    <input type="password" id="s-api-key" placeholder="مفتاح الـ Gemini..." value="${API_KEY}" style="width:92%; background:#150202; color:#fff; border:1px solid #ff3333; padding:8px; border-radius:8px; font-size:11px; outline:none; text-align:left;">
                    <select id="s-model-select" style="width:100%; background:#150202; color:#ffe6e6; border:1px solid #ff3333; padding:6px; border-radius:8px; margin-top:6px; font-size:11px; outline:none;">
                        <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                        <option value="gemini-2.5-pro">gemini-2.5-pro</option>
                    </select>
                </div>

                <div id="ocr-lang-box" style="display:${translationMode === 'free' ? 'flex' : 'none'}; justify-content:space-between; align-items:center; margin-bottom:10px;">
                    <span style="font-size:11px; color:#ff8080;">لغة المانجا الأصلية:</span>
                    <select id="s-ocr-lang" style="background:#150202; color:#ffe6e6; border:1px solid #ff3333; padding:4px 8px; border-radius:8px; font-size:11px; outline:none; cursor:pointer;">
                        <option value="eng">الإنجليزية (Default)</option>
                        <option value="kor">الكورية (Korean)</option>
                        <option value="jpn">اليابانية (Japanese)</option>
                    </select>
                </div>

                <button id="s-start-trans" style="width:100%; background:linear-gradient(135deg, #300000, #7a0000); border:1px solid #ff3333; padding:10px; border-radius:10px; color:#fff; font-weight:bold; font-size:12px; cursor:pointer; transition:all 0.3s; box-shadow:0 0 10px rgba(255,0,0,0.35);">🌐 تفعيل التبييض والترجمة الفورية (OFF)</button>
            </div>

            <div style="display:flex; gap:5px; margin-bottom:10px;">
                <button id="s-go-search" style="background:#ff1a1a; border:none; width:40px; border-radius:10px; color:#fff; cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:14px; box-shadow:0 0 5px rgba(255,0,0,0.3);">🔍</button>
                <input type="text" id="s-input" placeholder="بحث مانهوا.." style="flex:1; background:#150202; color:#fff; border:1px solid #ff3333; padding:8px; border-radius:10px; font-size:12px; outline:none;">
            </div>

            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:5px; margin-bottom:10px;">
                 <button id="s-clean" style="background:rgba(255,26,26,0.18); border:1px solid #ff1a1a; padding:8px; border-radius:10px; color:#ff8080; font-size:11px; cursor:pointer;">🎬 تنظيف الإعلانات</button>
                 <button id="s-scroll" style="background:#222; border:1px solid #ff3333; padding:8px; border-radius:10px; color:white; font-size:11px; cursor:pointer;">⏯ تمرير آلي</button>
            </div>

            <div style="display:grid; grid-template-columns: 1fr 1.5fr 1fr; gap:5px; margin-bottom:10px;">
                <button id="s-prev" style="background:#222; border:1px solid #444; padding:10px; border-radius:10px; font-size:11px; cursor:pointer; color:white;">السابق</button>
                <button id="s-jump" style="background:#ff1a1a; border:none; border-radius:10px; color:#fff; font-weight:bold; cursor:pointer; box-shadow:0 0 5px rgba(255,0,0,0.3);">انتقال</button>
                <button id="s-next" style="background:#222; border:1px solid #444; padding:10px; border-radius:10px; font-size:11px; cursor:pointer; color:white;">التالي</button>
            </div>

            <div style="background:rgba(20,2,2,0.65); padding:12px; border-radius:16px; border:1px solid rgba(255,26,26,0.18);">
                <div style="margin-bottom:8px;"><div style="display:flex; justify-content:space-between; font-size:10px; color:#ffb3b3;"><span>سرعة التمرير</span><span id="v-speed">2</span></div><input type="range" id="r-speed" min="1" max="50" value="2" style="width:100%; accent-color:#ff1a1a;"></div>
                <div style="margin-bottom:8px;"><div style="display:flex; justify-content:space-between; font-size:10px; color:#ff3333;"><span>التشبع %</span><span id="v-sat">100</span></div><input type="range" id="r-sat" min="50" max="250" value="100" style="width:100%; accent-color:#ff1a1a;"></div>
                <div style="margin-bottom:8px;"><div style="display:flex; justify-content:space-between; font-size:10px; color:#ff6666;"><span>الوضوح %</span><span id="v-con">100</span></div><input type="range" id="r-con" min="50" max="200" value="100" style="width:100%; accent-color:#ff1a1a;"></div>
                <div><div style="display:flex; justify-content:space-between; font-size:10px; color:#ff8080;"><span>السطوع %</span><span id="v-bri">100</span></div><input type="range" id="r-bri" min="30" max="150" value="100" style="width:100%; accent-color:#ff1a1a;"></div>
            </div>
        `;
        root.appendChild(menu);

        const modeSelect = document.getElementById('s-trans-mode');
        const geminiBox = document.getElementById('gemini-key-box');
        const ocrBox = document.getElementById('ocr-lang-box');
        const startBtn = document.getElementById('s-start-trans');
        const langSelect = document.getElementById('s-ocr-lang');
        const apiKeyInput = document.getElementById('s-api-key');
        const modelSelect = document.getElementById('s-model-select');

        langSelect.value = ocrLanguage;
        modelSelect.value = currentModel;

        modeSelect.onchange = function() {
            translationMode = this.value;
            saveSetting('mode', translationMode);
            geminiBox.style.display = translationMode === 'gemini' ? 'block' : 'none';
            ocrBox.style.display = translationMode === 'free' ? 'flex' : 'none';
        };

        langSelect.onchange = async function() {
            ocrLanguage = this.value;
            saveSetting('ocr_lang', ocrLanguage);
            showNotification(`تم تغيير لغة المسح إلى: ${this.options[this.selectedIndex].text}`);
            
            // في حال تغيير اللغة يتم تدمير المحرك القديم لتهيئة محرك باللغة الجديدة
            if (autoTranslateActive) {
                await terminateGlobalTesseract();
                await initGlobalTesseract();
            }
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
                this.style.background = "linear-gradient(135deg, #300000, #7a0000)";
                this.style.color = "#fff";
                this.innerText = "🌐 تفعيل التبييض والترجمة الفورية (OFF)";
                await terminateGlobalTesseract();
                showNotification("تم إيقاف الترجمة الفورية بنجاح.");
                return;
            }

            this.innerText = "⏳ جاري تهيئة المحرك الخارق...";
            try {
                if (translationMode === 'free') {
                    await initGlobalTesseract();
                }
                autoTranslateActive = true;
                this.style.background = "linear-gradient(135deg, #a00000, #ff1a1a)";
                this.style.color = "#fff";
                this.innerText = "🌐 الترجمة الفورية نشطة (ON)";
                showNotification("تم تفعيل نظام التبييض فائق السرعة والمستقر بنجاح!");
                startTranslationPipeline();
            } catch (err) {
                showNotification(err.message, "error");
                this.style.background = "linear-gradient(135deg, #ff4d4d, #222)";
                this.innerText = "❌ فشل التحميل";
            }
        };

        // فلاتر الصور العامة لمتعة القراءة
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

        sBtn.onclick = () => menu.style.display = menu.style.display === "none" ? "block" : "none";

        // تنظيف الصفحة والمنشورات غير الضرورية
        document.getElementById('s-clean').onclick = () => {
            document.querySelectorAll('header, footer, .ads, #header, iframe, .side-banners, .webtoon-side-ads').forEach(e => e.remove());
            showNotification("تم تصفية وتنظيف الصفحة كلياً!");
        };

        // التمرير التلقائي الذكي
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
                this.style.background = "#ff1a1a";
                this.style.color = "#fff";
            }
        };
        document.getElementById('r-speed').oninput = (e) => document.getElementById('v-speed').innerText = e.target.value;

        // محرك البحث لـ Slax
        document.getElementById('s-go-search').onclick = function() {
            const query = document.getElementById('s-input').value;
            if (query) {
                window.open(`https://www.google.com/search?q=${encodeURIComponent(query + " manga webtoon")}`);
            }
        };

        // تفعيل ميزة تحريك أيقونة التطبيق باللمس (متكاملة ومحسنة للموبايل)
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
