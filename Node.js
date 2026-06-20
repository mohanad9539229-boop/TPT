```javascript
// ==UserScript==
// @name         SLAX VIP V15.0 - Fast Dark Red OCR & Translator
// @namespace    https://viayoo.com/
// @version      15.0
// @description  نظام تبييض فوري فائق السرعة، ترجمة ذكية بدون تعليق، خطوط متناسقة، واجهة زجاجية باللون الأحمر الداكن الفاخر
// @author       Slax
// @run-at       document-start
// @match        *://*.webtoons.com/*
// @match        *://*/*
// @connect      *
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function() {
    'use strict';

    // مساحة تخزين الإعدادات المخصصة لـ Slax
    const STORAGE_PREFIX = "slax_v15_";
    const getSetting = (key, fallback) => localStorage.getItem(STORAGE_PREFIX + key) || fallback;
    const saveSetting = (key, val) => localStorage.setItem(STORAGE_PREFIX + key, val);

    let API_KEY = getSetting('api_key', '');
    let currentModel = getSetting('model', 'gemini-2.5-flash');
    let translationMode = getSetting('mode', 'free'); // 'free' أو 'gemini'
    let ocrLanguage = getSetting('ocr_lang', 'eng');
    let autoTranslateActive = false;
    let isProcessing = false;

    const TESSERACT_CDN = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
    const ICON_URL = "https://i.ibb.co/nMBFJ7kV/image.png";

    // تحميل مكتبة التعرف على الحروف
    function loadTesseract() {
        return new Promise((resolve, reject) => {
            if (window.Tesseract) return resolve();
            const script = document.createElement('script');
            script.src = TESSERACT_CDN;
            script.onload = () => resolve();
            script.onerror = () => reject(new Error("فشل تحميل محرك النصوص. تحقق من الإنترنت."));
            document.head.appendChild(script);
        });
    }

    // جلب الصورة متجاوزاً القيود الأمنية
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

    // محرك الترجمة المجاني الفائق السرعة لـ Google
    async function translateTextFree(text, fromLang) {
        const cleanedText = text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
        if (!cleanedText || cleanedText.length < 2) return "";
        
        let sourceLang = fromLang === 'eng' ? 'en' : (fromLang === 'kor' ? 'ko' : (fromLang === 'jpn' ? 'ja' : 'zh-CN'));
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
                            data[0].forEach(s => { if (s[0]) translated += s[0]; });
                        }
                        resolve(translated.trim());
                    } catch (e) {
                        resolve("");
                    }
                },
                onerror: () => resolve("")
            });
        });
    }

    // إشعار Slax الأنيق باللون الأحمر الداكن المتوهج
    function showNotification(msg, type = "info") {
        const notif = document.createElement('div');
        notif.style = `
            position:fixed; bottom:20px; right:20px; 
            background:rgba(25, 5, 5, 0.95); 
            color:${type === 'error' ? '#ff4d4d' : '#ff3333'}; 
            border:1px solid #ff1a1a; 
            padding:12px 24px; border-radius:12px; 
            z-index:2147483647; font-family:sans-serif; font-size:12px; 
            box-shadow:0 0 15px rgba(255, 0, 0, 0.4); direction:rtl; 
            transition: all 0.3s ease; backdrop-filter: blur(5px);
        `;
        notif.innerText = msg;
        document.body.appendChild(notif);
        setTimeout(() => {
            notif.style.opacity = '0';
            setTimeout(() => notif.remove(), 300);
        }, 3000);
    }

    // معالجة تبييض الصفحة وتركيب النصوص المترجمة بأحجام ذكية
    async function processImage(img) {
        if (img.dataset.ocrProcessed) return;
        img.dataset.ocrProcessed = "processing";

        // إظهار مؤشر صغير على الصورة يوضح أنها قيد الترجمة
        const loaderIndicator = document.createElement('div');
        loaderIndicator.innerText = "⚡ جاري التبييض والترجمة الفورية...";
        loaderIndicator.style = "position:absolute; background:rgba(139,0,0,0.85); color:#fff; font-size:10px; padding:4px 8px; border-radius:4px; z-index:99; font-family:sans-serif; pointer-events:none; left:5px; top:5px; border:1px solid #ff3333;";
        
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

            // تفعيل محيط التبييض وتوليد الحاوية فوراً
            const wrapper = document.createElement('div');
            wrapper.className = "slax-ocr-wrapper";
            wrapper.style = `position: relative; display: inline-block; width: ${img.clientWidth}px; height: ${img.clientHeight}px;`;
            
            img.parentNode.insertBefore(wrapper, img);
            wrapper.appendChild(img);
            wrapper.appendChild(loaderIndicator);

            img.style.width = "100%";
            img.style.height = "auto";
            img.style.display = "block";

            const scaleX = img.clientWidth / canvas.width;
            const scaleY = img.clientHeight / canvas.height;

            let paragraphs = [];

            if (translationMode === 'free') {
                // الفحص السريع والذكي والمباشر دون تعقيد لتقليل زمن المعالجة للنصف!
                const worker = await Tesseract.createWorker(ocrLanguage);
                const ret = await worker.recognize(canvas);
                paragraphs = ret.data.paragraphs;
                await worker.terminate();
            } else {
                if (!API_KEY) {
                    showNotification("يرجى إدخال مفتاح الـ Gemini أو تشغيل الوضع المجاني السريع!", "error");
                    img.removeAttribute('data-ocr-processed');
                    loaderIndicator.remove();
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
                                { text: "Detect all text bubbles, translate them to Arabic, output JSON: { 'translations': [{ 'text': 'arabic', 'bbox': { 'x0': int, 'y0': int, 'x1': int, 'y1': int } }] }." },
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
                for (const p of paragraphs) {
                    const bbox = p.bbox;
                    let originalText = p.text || "";
                    if (!bbox) continue;

                    // مسح الغيمة والتبييض الذكي بالاعتماد على درجة لون الغيمة الأصلية
                    const sampleX = Math.min(canvas.width - 1, Math.max(0, bbox.x0 - 3));
                    const sampleY = Math.min(canvas.height - 1, Math.max(0, bbox.y0 - 3));
                    const pixelData = ctx.getImageData(sampleX, sampleY, 1, 1).data;
                    const bgRgb = `rgb(${pixelData[0]}, ${pixelData[1]}, ${pixelData[2]})`;

                    ctx.fillStyle = bgRgb;
                    ctx.fillRect(bbox.x0 - 4, bbox.y0 - 4, (bbox.x1 - bbox.x0) + 8, (bbox.y1 - bbox.y0) + 8);

                    let arabicTranslation = originalText;
                    if (translationMode === 'free') {
                        arabicTranslation = await translateTextFree(originalText, ocrLanguage);
                    }

                    if (!arabicTranslation) continue;

                    // الحجم الذكي للخط: معادلة تمنع تضخم الخط على الهواتف والشاشات
                    const width = (bbox.x1 - bbox.x0) * scaleX;
                    const height = (bbox.y1 - bbox.y0) * scaleY;
                    
                    // حساب حجم خط مرن جداً ومتناسق مع حجم المساحة الممسوحة
                    let calculatedFontSize = Math.min(14, Math.max(9, (height * 0.18) + (width * 0.03)));

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
                        text-shadow: 1.5px 1.5px 0px #fff, -1.5px -1.5px 0px #fff, 1.5px -1.5px 0px #fff, -1.5px 1.5px 0px #fff;
                    `;

                    wrapper.appendChild(textOverlay);
                }

                img.src = canvas.toDataURL();
                img.dataset.ocrProcessed = "success";
            } else {
                img.dataset.ocrProcessed = "no-text";
            }
        } catch (err) {
            console.error(err);
            img.dataset.ocrProcessed = "failed";
        } finally {
            loaderIndicator.remove();
        }
    }

    // استدعاء مستمر لمعالجة صفحات المانجا المتبقية
    async function startTranslationPipeline() {
        if (!autoTranslateActive || isProcessing) return;
        isProcessing = true;

        const imgs = Array.from(document.querySelectorAll('img:not([data-ocr-processed])')).filter(i => i.clientHeight > 200);
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
        setTimeout(startTranslationPipeline, 2000);
    }

    // تصميم واجهة Slax الأنيقة (أحمر غامق، زجاج بلوري مع تدرجات متوهجة)
    function createSlaxUI() {
        if (document.getElementById('slax-root')) return;

        const root = document.createElement('div');
        root.id = 'slax-root';
        root.style = `position:fixed; top:${localStorage.getItem('slax_y') || '100px'}; left:${localStorage.getItem('slax_x') || '10px'}; z-index:2147483647; direction:rtl; font-family: system-ui, -apple-system, sans-serif; user-select: none;`;
        document.body.appendChild(root);

        const sBtn = document.createElement('div');
        sBtn.style = `width:55px; height:55px; background:linear-gradient(135deg, #cc0000, #4a0000); border:2px solid #ff3333; border-radius:50%; cursor:pointer; box-shadow:0 0 20px rgba(255,0,0,0.5); display:flex; align-items:center; justify-content:center; overflow:hidden; transition: transform 0.2s;`;
        sBtn.innerHTML = `<img src="${ICON_URL}" style="width:100%; height:100%; object-fit:cover; pointer-events:none;">`;
        root.appendChild(sBtn);

        const menu = document.createElement('div');
        menu.style = `
            display:none; 
            background: rgba(20, 3, 3, 0.88); 
            border: 1.5px solid #ff1a1a; 
            padding: 16px; 
            border-radius: 24px; 
            width: 310px; 
            margin-top: 12px; 
            color: #ffcccc; 
            box-shadow: 0 10px 30px rgba(0,0,0,0.8), inset 0 0 15px rgba(255, 0, 0, 0.2); 
            backdrop-filter: blur(15px);
            -webkit-backdrop-filter: blur(15px);
        `;
        
        menu.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; border-bottom:1px solid rgba(255,26,26,0.3); padding-bottom:8px;">
                <span style="color:#ff3333; font-weight:bold; font-size:13px; text-shadow:0 0 8px rgba(255,51,51,0.5);">👑 SLAX RED ULTIMATE V15</span>
                <span id="ai-status" style="font-size:10px; color:#ff3333; background: rgba(255,0,0,0.15); padding: 3px 10px; border-radius: 20px; font-weight:bold; border:0.5px solid rgba(255,26,26,0.4);">جاهز للعمل</span>
            </div>

            <!-- إعدادات المترجم والتبييض الفوري -->
            <div style="background:rgba(40, 5, 5, 0.7); padding:12px; border-radius:16px; margin-bottom:10px; border:1px solid rgba(255,26,26,0.25);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                    <span style="font-size:11px; color:#ff8080;">طريقة الترجمة:</span>
                    <select id="s-trans-mode" style="background:#150303; color:#ffcccc; border:1px solid #ff3333; padding:4px 8px; border-radius:8px; font-size:11px; outline:none; cursor:pointer;">
                        <option value="free">مجاني (سريع + بدون توكنات)</option>
                        <option value="gemini">ذكاء اصطناعي (Gemini Key)</option>
                    </select>
                </div>

                <div id="gemini-key-box" style="display:${translationMode === 'gemini' ? 'block' : 'none'}; margin-bottom:10px;">
                    <input type="password" id="s-api-key" placeholder="مفتاح الـ Gemini..." value="${API_KEY}" style="width:92%; background:#150303; color:#fff; border:1px solid #ff3333; padding:8px; border-radius:8px; font-size:11px; outline:none; text-align:left;">
                    <select id="s-model-select" style="width:100%; background:#150303; color:#ffcccc; border:1px solid #ff3333; padding:6px; border-radius:8px; margin-top:6px; font-size:11px; outline:none;">
                        <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                        <option value="gemini-2.5-pro">gemini-2.5-pro</option>
                    </select>
                </div>

                <div id="ocr-lang-box" style="display:${translationMode === 'free' ? 'flex' : 'none'}; justify-content:space-between; align-items:center; margin-bottom:10px;">
                    <span style="font-size:11px; color:#ff8080;">لغة المانجا الأصلية:</span>
                    <select id="s-ocr-lang" style="background:#150303; color:#ffcccc; border:1px solid #ff3333; padding:4px 8px; border-radius:8px; font-size:11px; outline:none; cursor:pointer;">
                        <option value="eng">الإنجليزية (Default)</option>
                        <option value="kor">الكورية (Korean)</option>
                        <option value="jpn">اليابانية (Japanese)</option>
                    </select>
                </div>

                <button id="s-start-trans" style="width:100%; background:linear-gradient(135deg, #2a0000, #660000); border:1px solid #ff3333; padding:10px; border-radius:10px; color:#fff; font-weight:bold; font-size:12px; cursor:pointer; transition:all 0.3s; box-shadow:0 0 10px rgba(255,0,0,0.3);">🌐 تفعيل التبييض والترجمة الفورية (OFF)</button>
            </div>

            <div style="display:flex; gap:5px; margin-bottom:10px;">
                <button id="s-go-search" style="background:#ff1a1a; border:none; width:40px; border-radius:10px; color:#fff; cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:14px; box-shadow:0 0 5px rgba(255,0,0,0.3);">🔍</button>
                <input type="text" id="s-input" placeholder="بحث مانهوا.." style="flex:1; background:#150303; color:#fff; border:1px solid #ff3333; padding:8px; border-radius:10px; font-size:12px; outline:none;">
            </div>

            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:5px; margin-bottom:10px;">
                 <button id="s-clean" style="background:rgba(255,26,26,0.15); border:1px solid #ff1a1a; padding:8px; border-radius:10px; color:#ff6666; font-size:11px; cursor:pointer;">🎬 تنظيف الإعلانات</button>
                 <button id="s-scroll" style="background:#222; border:1px solid #ff3333; padding:8px; border-radius:10px; color:white; font-size:11px; cursor:pointer;">⏯ تمرير آلي</button>
            </div>

            <div style="display:grid; grid-template-columns: 1fr 1.5fr 1fr; gap:5px; margin-bottom:10px;">
                <button id="s-prev" style="background:#222; border:1px solid #444; padding:10px; border-radius:10px; font-size:11px; cursor:pointer; color:white;">السابق</button>
                <button id="s-jump" style="background:#ff1a1a; border:none; border-radius:10px; color:#fff; font-weight:bold; cursor:pointer; box-shadow:0 0 5px rgba(255,0,0,0.3);">انتقال</button>
                <button id="s-next" style="background:#222; border:1px solid #444; padding:10px; border-radius:10px; font-size:11px; cursor:pointer; color:white;">التالي</button>
            </div>

            <div style="background:rgba(20,3,3,0.6); padding:12px; border-radius:16px; border:1px solid rgba(255,26,26,0.15);">
                <div style="margin-bottom:8px;"><div style="display:flex; justify-content:space-between; font-size:10px; color:#ff9999;"><span>سرعة التمرير</span><span id="v-speed">2</span></div><input type="range" id="r-speed" min="1" max="50" value="2" style="width:100%; accent-color:#ff1a1a;"></div>
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

        langSelect.onchange = function() {
            ocrLanguage = this.value;
            saveSetting('ocr_lang', ocrLanguage);
            showNotification(`تم تغيير لغة المسح إلى: ${this.options[this.selectedIndex].text}`);
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
                this.style.background = "linear-gradient(135deg, #2a0000, #660000)";
                this.style.color = "#fff";
                this.innerText = "🌐 تفعيل التبييض والترجمة الفورية (OFF)";
                showNotification("تم إيقاف الترجمة الفورية.");
                return;
            }

            this.innerText = "⏳ جاري تهيئة المحرك السريع...";
            try {
                if (translationMode === 'free') {
                    await loadTesseract();
                }
                autoTranslateActive = true;
                this.style.background = "linear-gradient(135deg, #990000, #ff1a1a)";
                this.style.color = "#fff";
                this.innerText = "🌐 الترجمة الفورية نشطة (ON)";
                showNotification("تم تفعيل نظام التبييض السريع وتعديل الخطوط التلقائي بنجاح!");
                startTranslationPipeline();
            } catch (err) {
                showNotification(err.message, "error");
                this.style.background = "linear-gradient(135deg, #ff4d4d, #222)";
                this.innerText = "❌ فشل التحميل";
            }
        };

        // تعديل فلاتر الصور
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

        // تنظيف الصفحة من الإعلانات
        document.getElementById('s-clean').onclick = () => {
            document.querySelectorAll('header, footer, .ads, #header, iframe, .side-banners, .webtoon-side-ads').forEach(e => e.remove());
            showNotification("تم إزالة الإعلانات والعناصر غير الضرورية!");
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
                this.style.background = "#ff1a1a";
                this.style.color = "#fff";
            }
        };
        document.getElementById('r-speed').oninput = (e) => document.getElementById('v-speed').innerText = e.target.value;

        // محرك البحث
        document.getElementById('s-go-search').onclick = function() {
            const query = document.getElementById('s-input').value;
            if (query) {
                window.open(`https://www.google.com/search?q=${encodeURIComponent(query + " manga webtoon")}`);
            }
        };

        // التحكم بالسحب والتحريك على الشاشة باللمس
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
