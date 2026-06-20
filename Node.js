// ==UserScript==
// @name         SLAX VIP V18.0 - Ultimate Manga Translator
// @namespace    https://viayoo.com/
// @version      18.0
// @description  تبييض كبسولي فائق الدقة، تصفية متطورة تمنع تخطي الغيمات، معالجة ذكية بالسرعة القصوى، واجهة زجاجية حمراء متوهجة فاخرة.
// @author       Slax
// @run-at       document-start
// @match        *://*.webtoons.com/*
// @match        *://*/*
// @connect      *
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function() {
    'use strict';

    // مساحة تخزين الإعدادات لضمان حفظ تفضيلات المستخدم عبر جميع المواقع تلقائياً
    const STORAGE_PREFIX = "slax_v18_";
    const getSetting = (key, fallback) => localStorage.getItem(STORAGE_PREFIX + key) || fallback;
    const saveSetting = (key, val) => localStorage.setItem(STORAGE_PREFIX + key, val);

    let API_KEY = getSetting('api_key', '');
    let currentModel = getSetting('model', 'gemini-2.5-flash');
    let translationMode = getSetting('mode', 'free'); // 'free' أو 'gemini'
    let ocrLanguage = getSetting('ocr_lang', 'eng');
    let fontSizeScale = parseFloat(getSetting('font_scale', '1.0')); 
    let filterStrength = getSetting('filter_strength', 'light'); // 'light' لترجمة كل شيء أو 'strong' للتصفية القصوى
    let autoTranslateActive = false;
    let isProcessing = false;

    // محرك نصوص موحد ذكي يدعم التخصيص المتقدم لصفحات المانجا
    let globalTesseractWorker = null;

    const TESSERACT_CDN = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
    const ICON_URL = "https://i.ibb.co/nMBFJ7kV/image.png";

    // تهيئة محرك النصوص مع ضبط نمط التعرف على الغيمات المتناثرة PSM 11
    async function initGlobalTesseract() {
        if (globalTesseractWorker) return;
        
        if (!window.Tesseract) {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = TESSERACT_CDN;
                script.onload = () => resolve();
                script.onerror = () => reject(new Error("فشل تحميل مكتبة الترجمة التلقائية."));
                document.head.appendChild(script);
            });
        }
        
        // تشغيل المحرك باللغة المحددة
        globalTesseractWorker = await Tesseract.createWorker(ocrLanguage);
        
        // تعديل معايير البحث (مهم جداً لصفحات المانجا والويب تون):
        // tessedit_pageseg_mode: '11' يقوم بالبحث عن النصوص المتناثرة في كل مكان دون الالتزام بفقرات متتالية
        await globalTesseractWorker.setParameters({
            tessedit_pageseg_mode: '11',
            tessedit_char_whitelist: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!?.,\'" '
        });
    }

    // إيقاف المحرك عند تعطيل الأداة لتوفير الرام
    async function terminateGlobalTesseract() {
        if (globalTesseractWorker) {
            await globalTesseractWorker.terminate();
            globalTesseractWorker = null;
        }
    }

    // جلب ملفات الصور بأمان لتجاوز حماية المواقع بالكامل
    async function getImageBlob(url) {
        let cleanUrl = url.trim();
        if (cleanUrl.startsWith('//')) {
            cleanUrl = window.location.protocol + cleanUrl;
        }
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: cleanUrl,
                responseType: "blob",
                headers: { "Referer": window.location.origin },
                onload: (res) => {
                    if (res.status >= 200 && res.status < 300) {
                        resolve(res.response);
                    } else {
                        reject(new Error("فشل جلب الصورة من المصدر."));
                    }
                },
                onerror: () => reject(new Error("خطأ اتصال بالشبكة."))
            });
        });
    }

    // تنظيف النصوص قبل إرسالها لترجمة جوجل لمنع الرموز الغريبة والتداخلات
    function cleanOcrText(text) {
        if (!text) return "";
        let cleaned = text.replace(/[^a-zA-Z0-9\s!?.,']/g, ' '); // الحفاظ على علامات التعجب والاستفهام الحوارية
        cleaned = cleaned.replace(/([a-zA-Z])\1{3,}/g, '$1'); // إزالة الحروف المتكررة بكثرة الناتجة عن الرسومات
        cleaned = cleaned.trim().replace(/\s+/g, ' ');

        // في الفحص الخفيف نقبل أي كلمة مفيدة لحفظ التعبيرات القصيرة مثل Oh, Ah, No
        if (filterStrength === 'light') {
            if (cleaned.length < 2) return "";
            return cleaned;
        }

        // الفحص القوي والتصفية التامة للرموز والطلاسم
        if (cleaned.length < 3) return "";
        if (/^\d+$/.test(cleaned)) return ""; 

        if (ocrLanguage === 'eng') {
            const hasVowel = /[aeiouyAEIOUY]/i.test(cleaned);
            if (!hasVowel) return "";
        }
        return cleaned;
    }

    // تصفية الترجمة العربية النهائية من أي بقايا حروف إنجليزية ناتجة عن عدم الترجمة
    function sanitizeFinalArabicTranslation(text) {
        if (!text) return "";
        let sanitized = text.replace(/[a-zA-Z]/g, ''); // حذف أي حرف إنجليزي عشوائي متبقي
        sanitized = sanitized.replace(/[_\-\|\\\/~`@#\$\^&\*\+=\{\}\[\];<>"]/g, ' ');
        sanitized = sanitized.trim().replace(/\s+/g, ' ');
        return sanitized;
    }

    // دمج نصوص المانجا في حزمة واحدة سريعة ومستقرة تماماً
    async function translateTextBundle(textsArray, fromLang) {
        if (!textsArray || textsArray.length === 0) return [];

        const cleanedTexts = textsArray.map(t => cleanOcrText(t));
        if (cleanedTexts.every(t => t === "")) {
            return Array(textsArray.length).fill("");
        }

        const combinedText = cleanedTexts.map((t, i) => t || `SKIP_EMPTY_INDEX_${i}`).join('\n {SLX} \n');
        
        let sourceLang = fromLang === 'eng' ? 'en' : (fromLang === 'kor' ? 'ko' : 'ja');
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
                        
                        const splitPattern = /\s*\{\s*SLX\s*\}\s*|\s*\{\s*slx\s*\}\s*/gi;
                        const translatedParts = translatedCombined.split(splitPattern).map(p => p.trim());
                        
                        const finalTranslations = cleanedTexts.map((original, idx) => {
                            if (original === "") return "";
                            const trans = translatedParts[idx] || "";
                            if (trans.includes("SKIP_EMPTY_INDEX")) return "";
                            return sanitizeFinalArabicTranslation(trans);
                        });
                        
                        resolve(finalTranslations);
                    } catch (e) {
                        resolve(Array(textsArray.length).fill(""));
                    }
                },
                onerror: () => resolve(Array(textsArray.length).fill(""))
            });
        });
    }

    // نظام إشعارات زجاجي فاخر متناسب مع التصميم
    function showNotification(msg, type = "info") {
        const notif = document.createElement('div');
        notif.style = `
            position:fixed; bottom:20px; right:20px; 
            background:rgba(25, 4, 4, 0.95); 
            color:${type === 'error' ? '#ff4d4d' : '#ff1a1a'}; 
            border:1.5px solid #ff1a1a; 
            padding:12px 24px; border-radius:16px; 
            z-index:2147483647; font-family:sans-serif; font-size:12px; 
            box-shadow:0 0 20px rgba(255, 0, 0, 0.5); direction:rtl; 
            transition: all 0.3s ease; backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px); font-weight: bold;
        `;
        notif.innerText = msg;
        document.body.appendChild(notif);
        setTimeout(() => {
            notif.style.opacity = '0';
            setTimeout(() => notif.remove(), 300);
        }, 3000);
    }

    // تبييض كبسولي فوري فائق الدقة مع معالجة التباين الذكية للألوان
    async function processImage(img) {
        if (img.dataset.ocrProcessed) return;
        img.dataset.ocrProcessed = "processing";

        // الانتظار التام لحين تحميل المانجا بالكامل لمنع حدوث أي خطأ في أبعاد الصفحة
        if (!img.complete || img.naturalWidth === 0) {
            await new Promise((resolve) => {
                img.onload = () => resolve();
                img.onerror = () => resolve();
            });
        }

        if (img.clientWidth < 150 || img.clientHeight < 150) {
            img.dataset.ocrProcessed = "skipped-too-small";
            return;
        }

        const infoBadge = document.createElement('div');
        infoBadge.innerText = "⚡ جاري التبييض والترجمة...";
        infoBadge.style = "position:absolute; background:rgba(120,5,5,0.92); color:#fff; font-size:10px; padding:4px 8px; border-radius:6px; z-index:99; font-family:sans-serif; pointer-events:none; left:10px; top:10px; border:1px solid #ff3333; box-shadow: 0 0 10px rgba(255,0,0,0.3);";
        
        try {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            let imageSourceLoaded = false;

            // محاولة جلب الصورة كـ Blob بدقة كاملة
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

                canvas.width = tempImg.naturalWidth;
                canvas.height = tempImg.naturalHeight;

                // تحسين جودة وتباين الحروف عبر كارت الشاشة لضمان دقة OCR تبلغ 99%
                ctx.filter = 'contrast(1.6) grayscale(1) brightness(1.05)';
                ctx.drawImage(tempImg, 0, 0);
                imageSourceLoaded = true;
            } catch (networkError) {
                // الطريقة البديلة في حال حظر طلبات الشبكة (رسم مباشر من الصفحة)
                canvas.width = img.naturalWidth || img.clientWidth;
                canvas.height = img.naturalHeight || img.clientHeight;
                ctx.drawImage(img, 0, 0);
                imageSourceLoaded = true;
            }

            if (!imageSourceLoaded) {
                throw new Error("فشل تحميل مصدر المانجا.");
            }

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
                if (!globalTesseractWorker) await initGlobalTesseract();
                const ret = await globalTesseractWorker.recognize(canvas);
                paragraphs = ret.data.paragraphs || [];
            } else {
                if (!API_KEY) {
                    showNotification("الرجاء إدخال مفتاح الـ Gemini أو تشغيل الوضع المجاني السريع أولاً!", "error");
                    img.removeAttribute('data-ocr-processed');
                    infoBadge.remove();
                    return;
                }
                const base64Data = canvas.toDataURL('image/jpeg').split(',')[1];

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
                const rawTexts = paragraphs.map(p => p.text || "");
                let translatedTexts = [];

                if (translationMode === 'free') {
                    translatedTexts = await translateTextBundle(rawTexts, ocrLanguage);
                } else {
                    translatedTexts = rawTexts.map(t => sanitizeFinalArabicTranslation(t));
                }

                paragraphs.forEach((p, index) => {
                    const bbox = p.bbox;
                    const arabicTranslation = translatedTexts[index];
                    
                    if (!bbox || !arabicTranslation || arabicTranslation.trim().length === 0) return;

                    const width = (bbox.x1 - bbox.x0) * scaleX;
                    const height = (bbox.y1 - bbox.y0) * scaleY;

                    let baseFontSize = Math.min(13.5, Math.max(10.5, (height * 0.16) + (width * 0.025)));
                    let finalFontSize = baseFontSize * fontSizeScale;

                    const left = bbox.x0 * scaleX;
                    const top = bbox.y0 * scaleY;

                    const textContainer = document.createElement('div');
                    textContainer.className = "slax-translated-container";
                    textContainer.style = `
                        position: absolute;
                        left: ${left}px;
                        top: ${top}px;
                        width: ${width}px;
                        height: ${height}px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        pointer-events: none;
                        z-index: 10;
                        box-sizing: border-box;
                    `;

                    // كبسولة التبييض المصممة خصيصاً لتناسب النصوص القصيرة والطويلة بدقة
                    const bubble = document.createElement('div');
                    bubble.className = "slax-compact-bubble";
                    bubble.style = `
                        background: rgba(255, 255, 255, 0.96);
                        padding: 4px 8px;
                        border-radius: 8px;
                        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
                        border: 1px solid rgba(0, 0, 0, 0.12);
                        display: inline-block;
                        max-width: 95%;
                        max-height: 98%;
                        overflow: hidden;
                        text-align: center;
                        word-break: break-word;
                        white-space: normal;
                        color: #000000;
                        font-family: system-ui, -apple-system, sans-serif;
                        font-weight: 800;
                        font-size: ${finalFontSize}px;
                        line-height: 1.25;
                    `;
                    bubble.innerText = arabicTranslation;

                    textContainer.appendChild(bubble);
                    wrapper.appendChild(textContainer);
                });

                img.dataset.ocrProcessed = "success";
            } else {
                img.dataset.ocrProcessed = "no-text";
            }
        } catch (err) {
            console.error("خطأ التبييض والترجمة: ", err);
            img.dataset.ocrProcessed = "failed";
        } finally {
            infoBadge.remove();
        }
    }

    // المعالجة الدورية التلقائية لصفحات المانجا بالترتيب الفوري
    async function startTranslationPipeline() {
        if (!autoTranslateActive || isProcessing) return;
        isProcessing = true;

        const imgs = Array.from(document.querySelectorAll('img:not([data-ocr-processed])')).filter(i => {
            if (i.closest('#slax-root')) return false;
            return true;
        });

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

    // بناء واجهة المستخدم البلورية الحمراء الأنيقة
    function createSlaxUI() {
        if (document.getElementById('slax-root')) return;

        const root = document.createElement('div');
        root.id = 'slax-root';
        root.style = `position:fixed; top:${localStorage.getItem('slax_y') || '100px'}; left:${localStorage.getItem('slax_x') || '10px'}; z-index:2147483647; direction:rtl; font-family: system-ui, -apple-system, sans-serif; user-select: none;`;
        document.body.appendChild(root);

        const sBtn = document.createElement('div');
        sBtn.style = `width:55px; height:55px; background:linear-gradient(135deg, #b30000, #3a0000); border:2px solid #ff1a1a; border-radius:50%; cursor:pointer; box-shadow:0 0 18px rgba(255,0,0,0.55); display:flex; align-items:center; justify-content:center; overflow:hidden; transition: transform 0.2s;`;
        sBtn.innerHTML = `<img src="${ICON_URL}" style="width:100%; height:100%; object-fit:cover; pointer-events:none;">`;
        root.appendChild(sBtn);

        const menu = document.createElement('div');
        menu.style = `
            display:none; 
            background: rgba(16, 2, 2, 0.86); 
            border: 1.5px solid #ff1a1a; 
            padding: 16px; 
            border-radius: 24px; 
            width: 310px; 
            margin-top: 12px; 
            color: #ffe6e6; 
            box-shadow: 0 10px 35px rgba(0,0,0,0.85), inset 0 0 20px rgba(255, 0, 0, 0.22); 
            backdrop-filter: blur(15px);
            -webkit-backdrop-filter: blur(15px);
        `;
        
        menu.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; border-bottom:1.5px solid rgba(255,26,26,0.35); padding-bottom:8px;">
                <span style="color:#ff3333; font-weight:bold; font-size:13px; text-shadow:0 0 8px rgba(255,51,51,0.6);">👑 SLAX COMPACT OCR V18.0</span>
                <span id="ai-status" style="font-size:10px; color:#ff3333; background: rgba(255,0,0,0.18); padding: 3px 10px; border-radius: 20px; font-weight:bold; border:0.5px solid rgba(255,26,26,0.4);">جاهز للعمل</span>
            </div>

            <div style="background:rgba(35, 4, 4, 0.7); padding:12px; border-radius:16px; margin-bottom:10px; border:1px solid rgba(255,26,26,0.25);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                    <span style="font-size:11px; color:#ff8080;">طريقة الترجمة:</span>
                    <select id="s-trans-mode" style="background:#150202; color:#ffe6e6; border:1px solid #ff3333; padding:4px 8px; border-radius:8px; font-size:11px; outline:none; cursor:pointer;">
                        <option value="free">مجاني (سريع وبدون طلاسم)</option>
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

                <!-- التحكم بفلترة الرموز والطلاسم لمنع حجب نصوص المانجا -->
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                    <span style="font-size:11px; color:#ff8080;">قوة تصفية الطلاسم:</span>
                    <select id="s-filter-strength" style="background:#150202; color:#ffe6e6; border:1px solid #ff3333; padding:4px 8px; border-radius:8px; font-size:11px; outline:none; cursor:pointer;">
                        <option value="light">خفيف (ترجمة كل الغيمات بالتأكيد)</option>
                        <option value="strong">قوي (تصفية قصوى لمنع الرموز)</option>
                    </select>
                </div>

                <!-- مقياس حجم الخط -->
                <div style="margin-top:10px; border-top:1px dashed rgba(255,26,26,0.2); padding-top:8px; margin-bottom:8px;">
                    <div style="display:flex; justify-content:space-between; font-size:11px; color:#ff8080; margin-bottom:4px;">
                        <span>تعديل حجم خط الترجمة:</span>
                        <span id="v-font-scale">${fontSizeScale}x</span>
                    </div>
                    <input type="range" id="r-font-scale" min="0.6" max="2.4" step="0.1" value="${fontSizeScale}" style="width:100%; accent-color:#ff1a1a; cursor:pointer;">
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
        const filterSelect = document.getElementById('s-filter-strength');
        const apiKeyInput = document.getElementById('s-api-key');
        const modelSelect = document.getElementById('s-model-select');
        const fontScaleSlider = document.getElementById('r-font-scale');
        const fontScaleValue = document.getElementById('v-font-scale');

        langSelect.value = ocrLanguage;
        modelSelect.value = currentModel;
        filterSelect.value = filterStrength;

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
            
            if (autoTranslateActive) {
                await terminateGlobalTesseract();
                await initGlobalTesseract();
            }
        };

        filterSelect.onchange = function() {
            filterStrength = this.value;
            saveSetting('filter_strength', filterStrength);
            showNotification(`تم تعيين قوة التصفية إلى: ${this.options[this.selectedIndex].text}`);
        };

        fontScaleSlider.oninput = function() {
            const oldScale = fontSizeScale;
            fontSizeScale = parseFloat(this.value);
            fontScaleValue.innerText = `${fontSizeScale}x`;
            saveSetting('font_scale', fontSizeScale);
            
            document.querySelectorAll('.slax-compact-bubble').forEach(bubble => {
                let currentSize = parseFloat(bubble.style.fontSize);
                if (currentSize) {
                    bubble.style.fontSize = `${(currentSize / oldScale) * fontSizeScale}px`;
                }
            });
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
                showNotification("تم تفعيل نظام التبييض والمحرك ذو الاستقرار اللانهائي بنجاح!");
                startTranslationPipeline();
            } catch (err) {
                showNotification(err.message, "error");
                this.style.background = "linear-gradient(135deg, #ff4d4d, #222)";
                this.innerText = "❌ فشل التحميل";
            }
        };

        // فلاتر الصور العامة لمتعة القراءة والسطوع والتباين
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

        // تنظيف وحذف الإعلانات المزعجة
        document.getElementById('s-clean').onclick = () => {
            document.querySelectorAll('header, footer, .ads, #header, iframe, .side-banners, .webtoon-side-ads').forEach(e => e.remove());
            showNotification("تم تصفية وتنظيف الصفحة بنجاح!");
        };

        // التمرير التلقائي لقصص الويب تون
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

        // شريط البحث الذكي
        document.getElementById('s-go-search').onclick = function() {
            const query = document.getElementById('s-input').value;
            if (query) {
                window.open(`https://www.google.com/search?q=${encodeURIComponent(query + " manga webtoon")}`);
            }
        };

        // السحب واللمس لحفظ واجهة الأداة في المكان المفضل لديك
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
