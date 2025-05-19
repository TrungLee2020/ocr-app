/* Cache DOM để giảm truy vấn */
const domElements = {
    // Dashboard
    sidebar: document.getElementById('sidebar'),
    sidebarToggle: document.getElementById('sidebar-toggle'),
    tabs: document.querySelectorAll('.tab-pane'),
    tabButtons: document.querySelectorAll('.tab-btn'),
    // OCR
    tabsOcr: document.querySelectorAll('.tab-content'),
    tabButtonsOcr: document.querySelectorAll('.flex button'),
    previewArea: document.getElementById('previewArea'),
    advancedPreviewArea: document.getElementById('advancedPreviewArea'),
    resultArea: document.getElementById('resultArea'),
    advancedResultArea: document.getElementById('advancedResultArea'),
    basicLanguage: document.getElementById('basicLanguage'),
    advancedDocType: document.getElementById('advancedDocType'),
    advancedPromptInput: document.getElementById('advancedPromptInput'),
    tablesCheckbox: document.getElementById('tables'),
    handwritingCheckbox: document.getElementById('handwriting'),
    preserveLayoutCheckbox: document.getElementById('preserveLayout'),
    fileInput: document.getElementById('fileInput'),
    advancedFileInput: document.getElementById('advancedFileInput'),
    basicLoading: document.getElementById('basicLoading'),
    advancedLoading: document.getElementById('advancedLoading')
};

/* Hằng số cấu hình */
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB/file
const MAX_TOTAL_SIZE = 50 * 1024 * 1024; // 50MB tổng
const MAX_FILES = 5; // Tối đa 5 file
const API_BASE_URL = 'http://localhost:5000';
const API_KEY = 'YOUR_FLASK_API_KEY_HERE'; // Thay bằng API key thực tế
const RETRY_MAX = 3;
const RETRY_DELAY = 1000;

/* Hàm debounce để giới hạn tần suất sự kiện */
function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

/* Hàm toggle sidebar trên di động (dashboard) */
function toggleSidebar() {
    if (domElements.sidebar) {
        domElements.sidebar.classList.toggle('open');
    }
}

/* Chuyển đổi tab OCR */
function showTab(tab) {
    // Ẩn tất cả tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.add('hidden');
    });
    
    // Hiển thị tab được chọn
    document.getElementById(`${tab}-tab`).classList.remove('hidden');
    
    // Cập nhật button style
    document.querySelectorAll('.flex button').forEach(btn => {
        if (btn.textContent.includes('cơ bản') && tab === 'basic') {
            btn.classList.add('bg-blue-600', 'text-white');
            btn.classList.remove('bg-gray-200', 'text-gray-700');
        } else if (btn.textContent.includes('nâng cao') && tab === 'advanced') {
            btn.classList.add('bg-blue-600', 'text-white');  
            btn.classList.remove('bg-gray-200', 'text-gray-700');
        } else {
            btn.classList.remove('bg-blue-600', 'text-white');
            btn.classList.add('bg-gray-200', 'text-gray-700');
        }
    });
}

/* Đặt giá trị mẫu cho prompt */
function setAdvancedPrompt(prompt) {
    if (domElements.advancedPromptInput) {
        domElements.advancedPromptInput.value = prompt;
    }
}

/* Hiển thị file trong khu vực xem trước */
function renderFilePreview(files, previewArea) {
    if (!files || files.length === 0) {
        previewArea.innerHTML = '<p class="text-center text-gray-500">Chưa có tài liệu để xem trước</p>';
        return;
    }

    const file = files[0];
    if (file.size > MAX_FILE_SIZE) {
        previewArea.innerHTML = `<div class="text-red-600 text-center">File ${file.name} quá lớn (tối đa 10MB)</div>`;
        return;
    }

    try {
        const fileURL = URL.createObjectURL(file);
        
        if (file.type === 'application/pdf') {
            const embed = document.createElement('embed');
            embed.src = fileURL;
            embed.type = 'application/pdf';
            embed.style.width = '100%';
            embed.style.height = '100%';
            embed.onload = () => URL.revokeObjectURL(fileURL);
            embed.onerror = () => {
                previewArea.innerHTML = `<div class="text-red-600 text-center">Lỗi khi hiển thị PDF: ${file.name}</div>`;
                URL.revokeObjectURL(fileURL);
            };
            previewArea.innerHTML = '';
            previewArea.appendChild(embed);
        } else if (file.type.startsWith('image/')) {
            const img = document.createElement('img');
            img.src = fileURL;
            img.alt = 'Uploaded image';
            img.className = 'max-w-full max-h-full object-contain mx-auto';
            img.onload = () => URL.revokeObjectURL(fileURL);
            img.onerror = () => {
                previewArea.innerHTML = `<div class="text-red-600 text-center">Lỗi khi hiển thị hình ảnh: ${file.name}</div>`;
                URL.revokeObjectURL(fileURL);
            };
            previewArea.innerHTML = '';
            previewArea.appendChild(img);
        } else {
            previewArea.innerHTML = `<div class="text-yellow-600 text-center">Định dạng file không được hỗ trợ: ${file.name}</div>`;
            URL.revokeObjectURL(fileURL);
        }
    } catch (error) {
        console.error(`Lỗi khi hiển thị file ${file.name}:`, error);
        previewArea.innerHTML = `<div class="text-red-600 text-center">Lỗi khi hiển thị tài liệu: ${file.name}</div>`;
    }
}

/* Xử lý upload file */
function handleFileUpload(event) {
    const files = event.target.files;
    if (domElements.previewArea) {
        renderFilePreview(files, domElements.previewArea);
    }
}

/* Xử lý upload file nâng cao */
function handleAdvancedFileUpload(event) {
    const files = event.target.files;
    if (domElements.advancedPreviewArea) {
        renderFilePreview(files, domElements.advancedPreviewArea);
    }
}

/* Tạo hoặc cập nhật thông báo trạng thái */
function createOrUpdateStatusMessage(resultContainer, message, type = 'info') {
    let statusDiv = resultContainer.parentElement.querySelector('.status-message');
    
    if (!statusDiv) {
        statusDiv = document.createElement('div');
        statusDiv.className = 'status-message mb-4 p-3 rounded font-medium';
        resultContainer.parentElement.insertBefore(statusDiv, resultContainer);
    }
    
    // Cập nhật class và nội dung
    statusDiv.className = 'status-message mb-4 p-3 rounded font-medium';
    
    switch (type) {
        case 'loading':
            statusDiv.classList.add('text-blue-600', 'bg-blue-50');
            break;
        case 'success':
            statusDiv.classList.add('text-green-600', 'bg-green-50');
            break;
        case 'error':
            statusDiv.classList.add('text-red-600', 'bg-red-50');
            break;
        default:
            statusDiv.classList.add('text-blue-600', 'bg-blue-50');
    }
    
    statusDiv.innerHTML = message;
    return statusDiv;
}

/* Xóa thông báo trạng thái */
function removeStatusMessage(resultContainer) {
    const statusDiv = resultContainer.parentElement.querySelector('.status-message');
    if (statusDiv) {
        statusDiv.remove();
    }
}

/* Gọi API OCR với streaming - Updated để dùng XMLHttpRequest */
async function callOcrApiStream(endpoint, formData, resultArea) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${API_BASE_URL}${endpoint}`, true);
        xhr.setRequestHeader('X-API-Key', API_KEY);
        
        let fileContainers = {};
        let receivedData = '';
        let pageBuffers = {}; // Buffer để sắp xếp các trang theo đúng thứ tự
        let pageCounters = {}; // Đếm số trang đã hiển thị cho mỗi file
        
        xhr.onreadystatechange = function() {
            if (xhr.readyState === 3 || xhr.readyState === 4) {
                // Lấy dữ liệu mới
                const newData = xhr.responseText.substring(receivedData.length);
                receivedData = xhr.responseText;
                
                // Xử lý từng dòng data
                const lines = newData.split('\n');
                lines.forEach(line => {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.substring(6));
                            
                            if (data.error) {
                                console.error('API Error:', data.error);
                                resultArea.innerHTML += `<div class="text-red-600 font-medium mb-2">❌ Lỗi: ${data.error}</div>`;
                                return;
                            }
                            
                            const { filename, page } = data;
                            
                            // Khởi tạo structures cho file mới
                            if (!fileContainers[filename]) {
                                const container = document.createElement('div');
                                container.className = 'result-file border-b border-gray-200 pb-4 mb-4';
                                container.innerHTML = `
                                    <h5 class="font-semibold text-lg text-gray-800 mb-2">📄 File: ${filename}</h5>
                                    <div class="file-pages"></div>
                                `;
                                fileContainers[filename] = container;
                                resultArea.appendChild(container);
                                pageBuffers[filename] = {};
                                pageCounters[filename] = 0; // Bắt đầu từ -1 để trang đầu tiên là 0
                            }
                            
                            // Lưu page vào buffer theo pageNumber thật từ backend
                            const realPageNumber = page.pageNumber || 0;
                            pageBuffers[filename][realPageNumber] = page;
                            
                            // Hiển thị các trang theo đúng thứ tự (từ trang tiếp theo chưa hiển thị)
                            const pagesContainer = fileContainers[filename].querySelector('.file-pages');
                            let nextPageToDisplay = pageCounters[filename] + 1;
                            
                            // Hiển thị tất cả các trang liên tiếp có sẵn
                            while (pageBuffers[filename][nextPageToDisplay]) {
                                const pageToShow = pageBuffers[filename][nextPageToDisplay];
                                
                                // Tạo page div
                                const pageDiv = document.createElement('div');
                                pageDiv.className = 'result-page bg-gray-50 p-3 mb-2 rounded';
                                
                                if (pageToShow.error) {
                                    pageDiv.innerHTML = `
                                        <div class="text-red-600">
                                            <strong>❌ Trang ${nextPageToDisplay}:</strong> ${pageToShow.error}
                                        </div>
                                    `;
                                } else {
                                    let pageContent = `
                                        <div class="mb-2">
                                            <strong class="text-blue-600">📄 Trang ${nextPageToDisplay}:</strong>
                                            ${pageToShow.processing_time ? `<span class="text-sm text-gray-500">(⏱️ ${pageToShow.processing_time}s)</span>` : ''}
                                        </div>
                                        <div class="text-gray-700 whitespace-pre-wrap bg-white p-2 rounded border">${pageToShow.text || 'Không có văn bản được nhận dạng'}</div>
                                    `;
                                    
                                    // Thêm structured data cho advanced OCR
                                    if (pageToShow.structuredData) {
                                        pageContent += `
                                            <div class="mt-2 p-2 bg-blue-50 rounded">
                                                <strong class="text-blue-700">📊 Dữ liệu có cấu trúc:</strong>
                                                <pre class="text-sm text-gray-600 mt-1 bg-white p-2 rounded border overflow-auto">${JSON.stringify(pageToShow.structuredData, null, 2)}</pre>
                                            </div>
                                        `;
                                    }
                                    
                                    // Thêm metadata cho advanced OCR
                                    if (pageToShow.metadata && pageToShow.metadata.document_type) {
                                        pageContent += `
                                            <div class="mt-2 text-sm text-gray-500">
                                                <span>📋 Loại giấy tờ: ${pageToShow.metadata.document_type}</span>
                                            </div>
                                        `;
                                    }
                                    
                                    pageDiv.innerHTML = pageContent;
                                }
                                
                                pagesContainer.appendChild(pageDiv);
                                
                                // Xóa khỏi buffer và cập nhật counter
                                delete pageBuffers[filename][nextPageToDisplay];
                                pageCounters[filename] = nextPageToDisplay;
                                nextPageToDisplay++;
                            }
                            
                            // Auto scroll xuống cuối
                            resultArea.scrollTop = resultArea.scrollHeight;
                            
                        } catch (error) {
                            console.error('Error parsing streaming data:', error);
                        }
                    }
                });
            }
        };
        
        xhr.onload = function() {
            if (xhr.status === 200) {
                resolve();
            } else {
                reject(new Error(`HTTP ${xhr.status}: ${xhr.statusText}`));
            }
        };
        
        xhr.onerror = function() {
            reject(new Error('Network error occurred'));
        };
        
        xhr.send(formData);
    });
}

/* Bắt đầu nhận dạng cơ bản */
async function startRecognition() {
    const { resultArea, basicLoading, fileInput, basicLanguage } = domElements;
    if (!resultArea || !basicLoading || !fileInput || !basicLanguage) return;

    try {
        // Kiểm tra file
        if (!fileInput.files || fileInput.files.length === 0) {
            alert('Vui lòng chọn ít nhất một file để xử lý');
            return;
        }

        // Hiển thị loading và clear kết quả cũ
        basicLoading.classList.remove('hidden');
        resultArea.innerHTML = '';
        
        // Tạo thông báo trạng thái bên ngoài
        createOrUpdateStatusMessage(resultArea, '🔄 Đang xử lý file...', 'loading');

        // Tạo FormData
        const formData = new FormData();
        Array.from(fileInput.files).forEach(file => {
            formData.append('file', file);
        });
        formData.append('language', basicLanguage.value);

        // Gọi API streaming
        await callOcrApiStream('/ocr/basic', formData, resultArea);
        
        // Cập nhật thông báo hoàn thành
        createOrUpdateStatusMessage(resultArea, '✅ Nhận dạng hoàn tất!', 'success');

    } catch (error) {
        console.error('Lỗi nhận dạng cơ bản:', error);
        
        // Hiển thị lỗi trong thông báo trạng thái
        createOrUpdateStatusMessage(resultArea, `❌ Lỗi nhận dạng: ${error.message}`, 'error');
        
        // Clear nội dung kết quả nếu có lỗi
        resultArea.innerHTML = '';
    } finally {
        basicLoading.classList.add('hidden');
    }
}

/* Bắt đầu nhận dạng nâng cao */
async function startAdvancedRecognition() {
    const { 
        advancedResultArea, 
        advancedLoading, 
        advancedFileInput, 
        advancedDocType, 
        tablesCheckbox, 
        handwritingCheckbox, 
        preserveLayoutCheckbox, 
        advancedPromptInput 
    } = domElements;
    
    if (!advancedResultArea || !advancedLoading || !advancedFileInput || !advancedDocType) return;

    try {
        // Kiểm tra file
        if (!advancedFileInput.files || advancedFileInput.files.length === 0) {
            alert('Vui lòng chọn ít nhất một file để xử lý');
            return;
        }

        // Hiển thị loading và clear kết quả cũ
        advancedLoading.classList.remove('hidden');
        advancedResultArea.innerHTML = '';
        
        // Tạo thông báo trạng thái bên ngoài
        createOrUpdateStatusMessage(advancedResultArea, '🔄 Đang xử lý file...', 'loading');

        // Tạo FormData
        const formData = new FormData();
        Array.from(advancedFileInput.files).forEach(file => {
            formData.append('file', file);
        });
        formData.append('documentType', advancedDocType.value);
        formData.append('prompt', advancedPromptInput.value);
        formData.append('options', JSON.stringify({
            tables: tablesCheckbox?.checked || false,
            handwriting: handwritingCheckbox?.checked || false,
            preserveLayout: preserveLayoutCheckbox?.checked || false
        }));

        // Gọi API streaming
        await callOcrApiStream('/ocr/advanced', formData, advancedResultArea);
        
        // Cập nhật thông báo hoàn thành
        createOrUpdateStatusMessage(advancedResultArea, '✅ Nhận dạng nâng cao hoàn tất!', 'success');

    } catch (error) {
        console.error('Lỗi nhận dạng nâng cao:', error);
        
        // Hiển thị lỗi trong thông báo trạng thái
        createOrUpdateStatusMessage(advancedResultArea, `❌ Lỗi nhận dạng: ${error.message}`, 'error');
        
        // Clear nội dung kết quả nếu có lỗi
        advancedResultArea.innerHTML = '';
    } finally {
        advancedLoading.classList.add('hidden');
    }
}

/* Khởi tạo sự kiện */
document.addEventListener('DOMContentLoaded', () => {
    // Dashboard: Sự kiện toggle sidebar
    if (domElements.sidebarToggle) {
        domElements.sidebarToggle.addEventListener('click', toggleSidebar);
    }

    // Dashboard: Sự kiện chuyển tab
    if (domElements.tabButtons) {
        domElements.tabButtons.forEach(btn => {
            if (btn.tagName === 'BUTTON') {
                btn.addEventListener('click', () => showTab(btn.dataset.tab));
            }
        });
    }

    // OCR: Initialize default tab
    showTab('basic');

    // OCR: Sự kiện upload file
    if (domElements.fileInput) {
        domElements.fileInput.addEventListener('change', debounce(handleFileUpload, 300));
    }
    if (domElements.advancedFileInput) {
        domElements.advancedFileInput.addEventListener('change', debounce(handleAdvancedFileUpload, 300));
    }

    console.log('🚀 SmartOCR initialized with streaming support');
});