import asyncio
import logging
from logging.handlers import RotatingFileHandler
import mimetypes
from flask import Flask, request, jsonify, Response
from flask_cors import CORS
import fitz  # PyMuPDF
import io
import base64
import requests
from PIL import Image
from concurrent.futures import ThreadPoolExecutor
import redis
import hashlib
import json
import functools
import time
import threading
from queue import Queue


# Thiết lập logging
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
file_handler = RotatingFileHandler('smartocr.log', maxBytes=10*1024*1024, backupCount=5, encoding='utf-8')
file_handler.setFormatter(formatter)
stream_handler = logging.StreamHandler()
stream_handler.setFormatter(formatter)
logger.addHandler(file_handler)
logger.addHandler(stream_handler)

# Khởi tạo Flask app
app = Flask(__name__)
CORS(app)

# Cấu hình
OCR_API_URL = 'https://c4f6-1-54-8-15.ngrok-free.app/ocr'  # Thay bằng URL API OCR
OCR_API_KEY = 'YOUR_OCR_API_KEY'  # Thay bằng API key OCR
API_KEY = 'YOUR_FLASK_API_KEY_HERE'  # Thay bằng key cho xác thực
app.config['MAX_CONTENT_LENGTH'] = 10 * 1024 * 1024  # 10MB/file

# Kết nối Redis
try:
    redis_client = redis.Redis(host='localhost', port=6379, db=0, decode_responses=True)
    # Test connection
    redis_client.ping()
    logger.info('Kết nối Redis thành công')
except:
    redis_client = None
    logger.warning('Không thể kết nối Redis, cache sẽ bị vô hiệu hóa')

# Thread pool với số lượng tối ưu
executor = ThreadPoolExecutor(max_workers=4)

# Middleware xác thực
def require_api_key(f):
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        api_key = request.headers.get('X-API-Key')
        if not api_key or api_key != API_KEY:
            logger.warning('Yêu cầu không được xác thực')
            return jsonify({'error': 'API key không hợp lệ'}), 401
        return f(*args, **kwargs)
    return decorated

# Tạo key cache với thêm thông tin file
def get_cache_key(file_data, params):
    hash_obj = hashlib.sha256()
    hash_obj.update(file_data)
    hash_obj.update(json.dumps(params, sort_keys=True).encode())
    return hash_obj.hexdigest()

# Chuyển PDF thành danh sách hình ảnh với tối ưu hóa
def pdf_to_images(pdf_data):
    logger.info('Bắt đầu tách các trang từ PDF')
    try:
        # pdf_data đã là bytes, không cần seek/read
        pdf_document = fitz.open(stream=pdf_data, filetype="pdf")
        images = []

        # Tối ưu hóa: Xử lý từng trang độc lập, giảm bộ nhớ
        for page_number in range(len(pdf_document)):
            page = pdf_document.load_page(page_number)
            # Sử dụng DPI 150 để đảm bảo chất lượng OCR tốt
            pix = page.get_pixmap(matrix=fitz.Matrix(150/72, 150/72), colorspace="rgb")
            img_data = pix.tobytes("png")
            img = Image.open(io.BytesIO(img_data))
            images.append(img)
            pix = None  # Giải phóng bộ nhớ

        pdf_document.close()
        logger.info(f'Tách thành công {len(images)} trang')
        return images
    except Exception as e:
        logger.error(f'Lỗi khi tách PDF: {str(e)}')
        raise

# Gọi API OCR - SYNC VERSION
def process_page_with_custom_ocr(image, language, prompt=None):
    logger.info('=== Gọi Custom OCR API ===')
    try:
        # Chuyển đổi hình ảnh thành bytes để gửi
        buffered = io.BytesIO()
        if image.mode != 'RGB':
            image = image.convert('RGB')
        image.save(buffered, format="JPEG", optimize=True, quality=85)
        img_bytes = buffered.getvalue()
        buffered.close()

        # Tạo cache key và log để debug
        cache_key = get_cache_key(img_bytes, {'language': language, 'prompt': prompt})
        logger.info(f"=== Cache key: {cache_key[:16]}... ===")
        
        # Kiểm tra cache trước
        if redis_client:
            try:
                cached_result = redis_client.get(cache_key)
                if cached_result:
                    logger.info('=== Lấy từ cache ===')
                    return json.loads(cached_result)
                else:
                    logger.info('=== Không có cache, gọi API ===')
            except Exception as e:
                logger.warning(f'=== Lỗi cache: {e}')

        # Gọi API
        logger.info('=== Gọi API OCR... ===')
        
        # Chuẩn bị request
        img_name = f"page_{int(time.time())}.jpg"
        files = {"origin_file": (img_name, img_bytes, "image/jpeg")}
        data = {"prompt": prompt or "OCR toàn bộ thông tin trong ảnh"}
        
        logger.info(f"=== URL: {OCR_API_URL} ===")
        logger.info(f"=== File: {img_name} ===")
        logger.info(f"Prompt: {data['prompt']}")

        # Gọi API đồng bộ
        start_time = time.time()
        response = requests.post(
            OCR_API_URL, 
            files=files, 
            data=data,
            timeout=120
        )
        end_time = time.time()
        
        logger.info(f"=== Request time: {end_time - start_time:.2f}s ===")
        logger.info(f"=== Status: {response.status_code} ===")
        
        if response.status_code == 200:
            logger.info("=== API SUCCESS! ===")
            api_response = response.json()
        else:
            logger.error(f"=== API FAILED! Status: {response.status_code} ===")
            logger.error(f"Response: {response.text}")
            response.raise_for_status()
        
        # Xử lý response
        text = api_response.get('data', '')
        task_id = api_response.get('task_id', '')
        processing_time = api_response.get('Time process', 0)

        logger.info(f"=== Text: {text[:100]}{'...' if len(text) > 100 else ''} ===")
        logger.info(f"=== Task ID: {task_id} ===")
        logger.info(f"=== Process time: {processing_time}s ===")

        # Tạo result
        result = {
            'text': text,
            'task_id': task_id,
            'processing_time': processing_time,
            'confidence': None,
            'structuredData': None
        }
        
        # Lưu vào cache
        if redis_client:
            try:
                redis_client.setex(cache_key, 86400, json.dumps(result))
                logger.info("💾 Saved to cache")
            except Exception as e:
                logger.warning(f'⚠️ Cache save error: {e}')
                
        return result
        
    except Exception as e:
        logger.error(f'=== OCR Error: {str(e)} ')
        raise

# Worker function cho threading
def ocr_worker(task_queue, result_queue):
    """Worker thread để xử lý OCR tasks"""
    while True:
        task = task_queue.get()
        if task is None:
            break
        
        try:
            filename, page_num, image, language, prompt, endpoint_type, document_type, options = task
            
            # Xử lý OCR
            result = process_page_with_custom_ocr(image, language, prompt)
            
            # Tạo page data
            page_data = {
                'pageNumber': page_num,
                'text': result['text'],
                'task_id': result.get('task_id'),
                'processing_time': result.get('processing_time', 0)
            }
            
            # Thêm metadata cho advanced
            if endpoint_type == 'advanced':
                page_data.update({
                    'confidence': result.get('confidence'),
                    'structuredData': result.get('structuredData'),
                    'metadata': {
                        'document_type': document_type,
                        'prompt_used': prompt,
                        'options': options
                    }
                })
            
            # Gửi kết quả
            result_queue.put({
                'filename': filename,
                'page': page_data,
                'success': True
            })
            
        except Exception as e:
            logger.error(f'Worker error: {e}')
            result_queue.put({
                'filename': filename,
                'page': {
                    'pageNumber': page_num,
                    'text': '',
                    'error': str(e),
                    'task_id': None,
                    'processing_time': 0
                },
                'success': False
            })
        finally:
            task_queue.task_done()

# Generator function for streaming OCR results - SYNC VERSION
def stream_ocr_results(files_data, endpoint_type, language=None, document_type=None, options=None, prompt=None):
    """Generator để stream kết quả OCR - sử dụng threading thay vì async"""
    
    # Tạo queue cho tasks và results
    task_queue = Queue()
    result_queue = Queue()
    
    # Đếm tổng số tasks
    total_tasks = 0
    
    # Thêm tất cả tasks vào queue
    for file_info in files_data:
        filename, file_data, mime_type = file_info
        
        logger.info(f"=== Preparing file: {filename} ===")
        
        try:
            if mime_type not in ['application/pdf', 'image/jpeg', 'image/png']:
                yield f"data: {json.dumps({'filename': filename, 'error': 'Định dạng file không được hỗ trợ'})}\n\n"
                continue

            # Xử lý file
            if mime_type == 'application/pdf':
                images = pdf_to_images(file_data)
                for i, img in enumerate(images, 1):
                    task_queue.put((filename, i, img, language or 'Tiếng Việt', prompt, endpoint_type, document_type, options))
                    total_tasks += 1
            else:
                # Xử lý hình ảnh đơn
                image = Image.open(io.BytesIO(file_data))
                task_queue.put((filename, 1, image, language or 'Tiếng Việt', prompt, endpoint_type, document_type, options))
                total_tasks += 1
                
        except Exception as e:
            logger.error(f'Lỗi chuẩn bị file {filename}: {e}')
            yield f"data: {json.dumps({'filename': filename, 'error': str(e)})}\n\n"
    
    # Khởi tạo worker threads
    worker_count = min(4, total_tasks)  # Tối đa 4 workers
    workers = []
    
    for _ in range(worker_count):
        worker = threading.Thread(target=ocr_worker, args=(task_queue, result_queue))
        worker.daemon = True
        worker.start()
        workers.append(worker)
    
    # Thu thập kết quả
    completed_tasks = 0
    while completed_tasks < total_tasks:
        try:
            # Chờ kết quả với timeout
            result = result_queue.get(timeout=60)  # 60s timeout
            yield f"data: {json.dumps(result)}\n\n"
            completed_tasks += 1
            result_queue.task_done()
        except:
            # Timeout hoặc lỗi khác
            break
    
    # Dừng workers
    for _ in workers:
        task_queue.put(None)
    
    # Chờ workers hoàn thành
    for worker in workers:
        worker.join(timeout=5)

# Endpoint Nhận dạng cơ bản với streaming - FIXED
@app.route('/ocr/basic', methods=['POST'])
@require_api_key
def basic_ocr():
    logger.info('=== Nhận yêu cầu Basic OCR ===')
    
    try:
        # Lấy parameters
        files = request.files.getlist('file')
        if not files or all(f.filename == '' for f in files):
            return jsonify({'error': 'Vui lòng tải lên ít nhất một file'}), 400
            
        language = request.form.get('language', 'Tiếng Việt')
        
        # Đọc file data TRƯỚC KHI pass vào generator
        files_data = []
        for file in files:
            if file.filename == '':
                continue
                
            # Đọc file data
            file.seek(0)
            file_data = file.read()
            
            # Xác định mime type
            mime_type, _ = mimetypes.guess_type(file.filename)
            if not mime_type:
                if file.filename.lower().endswith('.pdf'):
                    mime_type = 'application/pdf'
                elif file.filename.lower().endswith(('.jpg', '.jpeg')):
                    mime_type = 'image/jpeg'
                elif file.filename.lower().endswith('.png'):
                    mime_type = 'image/png'
                else:
                    continue
                    
            files_data.append((file.filename, file_data, mime_type))
        
        if not files_data:
            return jsonify({'error': 'Không có file hợp lệ để xử lý'}), 400
        
        # Tạo generator và wrap trong Response
        def generate():
            try:
                for item in stream_ocr_results(files_data, 'basic', language=language):
                    yield item
            except Exception as e:
                logger.error(f'Basic OCR stream error: {e}')
                yield f"data: {json.dumps({'error': str(e)})}\n\n"
        
        return Response(
            generate(),
            mimetype='text/event-stream',
            headers={
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'X-API-Key, Content-Type',
            }
        )
        
    except Exception as e:
        logger.error(f'Basic OCR error: {str(e)}')
        return jsonify({'error': str(e)}), 500

# Endpoint Nhận dạng nâng cao với streaming - FIXED
@app.route('/ocr/advanced', methods=['POST'])
@require_api_key  
def advanced_ocr():
    logger.info('📥 Nhận yêu cầu Advanced OCR')
    
    try:
        # Lấy parameters
        files = request.files.getlist('file')
        if not files or all(f.filename == '' for f in files):
            return jsonify({'error': 'Vui lòng tải lên ít nhất một file'}), 400
            
        document_type = request.form.get('documentType', 'Khác')
        prompt = request.form.get('prompt', '')
        options_str = request.form.get('options', '{}')
        
        # Parse options safely
        try:
            options = json.loads(options_str)
        except:
            options = {}
        
        # Đọc file data TRƯỚC KHI pass vào generator
        files_data = []
        for file in files:
            if file.filename == '':
                continue
                
            # Đọc file data
            file.seek(0)
            file_data = file.read()
            
            # Xác định mime type
            mime_type, _ = mimetypes.guess_type(file.filename)
            if not mime_type:
                if file.filename.lower().endswith('.pdf'):
                    mime_type = 'application/pdf'
                elif file.filename.lower().endswith(('.jpg', '.jpeg')):
                    mime_type = 'image/jpeg'
                elif file.filename.lower().endswith('.png'):
                    mime_type = 'image/png'
                else:
                    continue
                    
            files_data.append((file.filename, file_data, mime_type))
        
        if not files_data:
            return jsonify({'error': 'Không có file hợp lệ để xử lý'}), 400
        
        # Tạo generator và wrap trong Response
        def generate():
            try:
                for item in stream_ocr_results(
                    files_data, 'advanced', 
                    language='Tiếng Việt',
                    document_type=document_type,
                    options=options,
                    prompt=prompt
                ):
                    yield item
            except Exception as e:
                logger.error(f'Advanced OCR stream error: {e}')
                yield f"data: {json.dumps({'error': str(e)})}\n\n"
        
        return Response(
            generate(),
            mimetype='text/event-stream',
            headers={
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'X-API-Key, Content-Type',
            }
        )
        
    except Exception as e:
        logger.error(f'Advanced OCR error: {str(e)}')
        return jsonify({'error': str(e)}), 500

# Function kiểm tra API OCR
# def check_ocr_api_health():
#     """Kiểm tra kết nối đến API OCR"""
#     try:
#         # Thử gọi API OCR với timeout ngắn
#         response = requests.get(
#             f"{OCR_API_URL.rstrip('/ocr')}/health",
#             timeout=5
#         )
#         if response.status_code == 200:
#             return 'healthy'
#         else:
#             return f'unhealthy (status: {response.status_code})'
#     except requests.exceptions.Timeout:
#         return 'unhealthy (timeout)'
#     except requests.exceptions.ConnectionError:
#         return 'unhealthy (connection failed)'
#     except Exception as e:
#         return f'unhealthy (error: {str(e)})'
    
# Endpoint kiểm tra trạng thái
@app.route('/health', methods=['GET'])
def health_check():
    status = {
        'status': 'healthy',
        'redis': 'connected' if redis_client else 'disconnected',
        'ocr_api': 'configured',
        'streaming': 'enabled (threading-based)'
    }
    return jsonify(status)

# Error handlers
@app.errorhandler(413)
def too_large(e):
    return jsonify({'error': 'File quá lớn. Kích thước tối đa là 10MB'}), 413

@app.errorhandler(500)
def internal_error(e):
    logger.error(f'Internal server error: {str(e)}')
    return jsonify({'error': 'Lỗi máy chủ nội bộ'}), 500

if __name__ == '__main__':
    logger.info('=============Khởi động Flask server với threading-based streaming=============')
    app.run(debug=False, host='0.0.0.0', port=5000)