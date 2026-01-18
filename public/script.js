const fileInput = document.getElementById('fileInput');
const uploadLabel = document.getElementById('uploadLabel');
const polaroidContent = document.getElementById('polaroidContent');
const polaroidImage = document.getElementById('polaroidImage');
const uploadPlaceholder = document.getElementById('uploadPlaceholder');
const submitBtn = document.getElementById('submitBtn');
const loading = document.getElementById('loading');
const message = document.getElementById('message');
const filename = document.getElementById('filename');
const optimizeToggle = document.getElementById('optimizeToggle');
const toggleContainer = document.getElementById('toggleContainer');
const styleSelector = document.getElementById('styleSelector');
const imageStyleSelect = document.getElementById('imageStyleSelect');

let selectedFile = null;
let originalImageDataUrl = null;
let optimizedImageDataUrl = null;
const CACHE_KEY_PREFIX = 'wedding_card_';

// ---------- Cache Layer (Async IndexedDB + Fallback LocalStorage) ----------

const imageCache = (() => {
    const DB_NAME = 'WeddingCardDB';
    const STORE = 'images';
    const VERSION = 1;

    function getCompositeKey(fileName, style) {
        return `${fileName}_style_${style}`;
    }

    async function openDB() {
        return new Promise((resolve, reject) => {
            if (!window.indexedDB) return resolve(null);
            const req = indexedDB.open(DB_NAME, VERSION);

            req.onerror = () => resolve(null);

            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE)) {
                    db.createObjectStore(STORE, { keyPath: 'key' });
                }
            };

            req.onsuccess = (e) => resolve(e.target.result);
        });
    }

    async function get(fileName, style) {
        const key = getCompositeKey(fileName, style);
        const db = await openDB();
        if (!db) {
            const cached = localStorage.getItem(CACHE_KEY_PREFIX + key);
            return cached || null;
        }

        return new Promise((resolve) => {
            const tx = db.transaction([STORE], 'readonly');
            const store = tx.objectStore(STORE);
            const req = store.get(key);

            req.onerror = () => {
                const cached = localStorage.getItem(CACHE_KEY_PREFIX + key);
                resolve(cached || null);
            };

            req.onsuccess = () => {
                if (req.result) resolve(req.result.data);
                else {
                    const cached = localStorage.getItem(CACHE_KEY_PREFIX + key);
                    resolve(cached || null);
                }
            };
        });
    }

    async function set(fileName, style, dataUrl) {
        const key = getCompositeKey(fileName, style);
        const db = await openDB();

        if (!db) {
            try {
                localStorage.setItem(CACHE_KEY_PREFIX + key, dataUrl);
            } catch (e) {
                console.warn('Storage quota exceeded:', e);
            }
            return;
        }

        return new Promise((resolve) => {
            const tx = db.transaction([STORE], 'readwrite');
            const store = tx.objectStore(STORE);

            store.put({
                key,
                fileName,
                style,
                data: dataUrl,
                timestamp: Date.now()
            });

            tx.oncomplete = () => resolve();
            tx.onerror = () => {
                try {
                    localStorage.setItem(CACHE_KEY_PREFIX + key, dataUrl);
                } catch (e) {
                    console.warn('Storage quota exceeded:', e);
                }
                resolve();
            };
        });
    }

    async function dumpStore() {
        const db = await openDB();
        const tx = db.transaction('imageCache', 'readonly');
        const store = tx.objectStore('imageCache');

        return new Promise((resolve, reject) => {
            const result = [];
            const req = store.openCursor();

            req.onsuccess = (e) => {
            const cursor = e.target.result;
            if (!cursor) return resolve(result);
            result.push({ key: cursor.key, value: cursor.value });
            cursor.continue();
            };

            req.onerror = reject;
        });
    }

    window.dumpCache = dumpStore;

    return { get, set };
})();


// ---------- UI Event Handlers ----------

// Open file dialog
uploadLabel.addEventListener('click', () => fileInput.click());

// File selection
fileInput.addEventListener('change', (e) => handleFileSelect(e.target.files[0]));

// Drag/drop
uploadLabel.addEventListener('dragover', (e) => {
    e.preventDefault();
    polaroidContent.classList.add('dragover');
});
uploadLabel.addEventListener('dragleave', () => polaroidContent.classList.remove('dragover'));
uploadLabel.addEventListener('drop', (e) => {
    e.preventDefault();
    polaroidContent.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) handleFileSelect(e.dataTransfer.files[0]);
});

// Optimization toggle
optimizeToggle.addEventListener('change', async (e) => {
    if (!selectedFile) return;

    if (e.target.checked) {
        loading.style.display = 'block';
        optimizeToggle.disabled = true;
        clearMessage();

        const style = imageStyleSelect.value;
        const cached = await imageCache.get(selectedFile.name, style);

        if (cached) {
            optimizedImageDataUrl = cached;
            polaroidImage.style.backgroundImage = `url(${cached})`;
            loading.style.display = 'none';
            optimizeToggle.disabled = false;
            // showMessage('Loaded cached optimized image', 'success');
        } else {
            await optimizeImage(style);
        }

    } else {
        if (originalImageDataUrl) {
            polaroidImage.style.backgroundImage = `url(${originalImageDataUrl})`;
        }
    }
});

// ---------- Image Handling ----------

function handleFileSelect(file) {
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        showMessage('Please select a valid image file', 'error');
        return;
    }

    if (file.size > 50 * 1024 * 1024) {
        showMessage('File size must be less than 50MB', 'error');
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        originalImageDataUrl = e.target.result;
        optimizedImageDataUrl = null;

        polaroidImage.style.backgroundImage = `url(${originalImageDataUrl})`;
        polaroidImage.classList.add('active');
        uploadPlaceholder.style.display = 'none';

        toggleContainer.style.display = 'flex';
        styleSelector.classList.add('active');
        optimizeToggle.checked = false;
    };
    reader.readAsDataURL(file);

    selectedFile = file;
    filename.textContent = file.name;
    submitBtn.disabled = false;
    clearMessage();
}

// Optimize against server API
async function optimizeImage(style) {
    try {
        const formData = new FormData();
        formData.append('image', selectedFile);
        formData.append('imageStyleIndex', style);

        const response = await fetch('/api/optimize-image', { method: 'POST', body: formData });

        if (!response.ok) {
            const { error } = await response.json();
            showMessage(`Optimization failed: ${error || 'Unknown error'}`, 'error');
            optimizeToggle.checked = false;
            loading.style.display = 'none';
            optimizeToggle.disabled = false;
            return;
        }

        const blob = await response.blob();
        const dataUrl = await blobToDataURL(blob);

        optimizedImageDataUrl = dataUrl;
        polaroidImage.style.backgroundImage = `url(${dataUrl})`;

        await imageCache.set(selectedFile.name, style, dataUrl);

        // showMessage('Image optimized successfully!', 'success');
    } catch (e) {
        showMessage(`Error: ${e.message}`, 'error');
        optimizeToggle.checked = false;
    } finally {
        loading.style.display = 'none';
        optimizeToggle.disabled = false;
    }
}

function blobToDataURL(blob) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.readAsDataURL(blob);
    });
}

// ---------- Upload Submission ----------

submitBtn.addEventListener('click', async () => {
    if (!selectedFile) return;

    const formData = new FormData();

    if (optimizeToggle.checked && optimizedImageDataUrl) {
        // Convert dataURL back to Blob
        const res = await fetch(optimizedImageDataUrl);
        const blob = await res.blob();
        const optimizedFile = new File([blob], selectedFile.name, { type: blob.type });
        formData.append('file', optimizedFile);
    } else {
        formData.append('file', selectedFile);
    }

    submitBtn.disabled = true;
    loading.style.display = 'block';
    clearMessage();

    try {
        const response = await fetch('/api/upload', { method: 'POST', body: formData });
        const data = await response.json();

        if (response.ok) {
            showMessage('อัปโหลดสำเร็จ! ขั้นตอนที่ 2: เรากำลังพิมพ์การ์ดอวยพรของคุณที่โต๊ะรับแขก สามารถเขียนข้อความอวยพรบ่าวสาวบนการ์ด แล้วนำไปจัดแสดงบนบอร์ดเลยครับ 👰🤵💌', 'success');
            resetForm();
        } else {
            showMessage(`Error: ${data.error || 'Upload failed'}`, 'error');
            submitBtn.disabled = false;
        }
    } catch (error) {
        showMessage(`Error: ${error.message}`, 'error');
        submitBtn.disabled = false;
    } finally {
        loading.style.display = 'none';
    }
});

// ---------- Helpers ----------

function showMessage(text, type) {
    message.textContent = text;
    message.className = `message ${type}`;
    message.style.display = 'block';
}

function clearMessage() {
    message.style.display = 'none';
    message.textContent = '';
}

function resetForm() {
    selectedFile = null;
    originalImageDataUrl = null;
    optimizedImageDataUrl = null;
    fileInput.value = '';
    filename.textContent = 'Click to select a photo';
    submitBtn.disabled = true;
    polaroidImage.style.backgroundImage = '';
    polaroidImage.classList.remove('active');
    uploadPlaceholder.style.display = 'flex';
    toggleContainer.style.display = 'none';
    styleSelector.classList.remove('active');
    optimizeToggle.checked = false;
}
