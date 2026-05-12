# Media Worker Service

## Overview

Media Worker là Kafka consumer background xử lý media sau khi upload. Nhận events từ topic `media.uploaded`, thực hiện image/video processing, cập nhật trạng thái MongoDB, và publish `media.ready` hoặc `media.failed`. Không expose HTTP hay TCP endpoints.

## Role trong hệ thống

- **Input**: Kafka topic `media.uploaded` (file đã upload lên MinIO, chờ xử lý)
- **Output**:
  - Kafka `media.ready` — xử lý hoàn tất, variants sẵn sàng
  - Kafka `media.failed` — xử lý thất bại vĩnh viễn
  - MongoDB: cập nhật status và variant metadata
  - MinIO: upload các variants (thumbnail, preview, poster, video resizes)

---

## Architecture

The implementation uses a two-tier in-process pipeline.

### Tier 1: Kafka consumer

`MediaProcessingConsumer`:

- Consumer group: `nest-chat.media-worker`
- Consumes `media.uploaded`
- Enqueues a lightweight in-memory job
- Returns immediately so Kafka can acknowledge fast

### Tier 2: Processing queue

`ProcessingJobService`:

- In-memory `p-queue`
- Default concurrency: `MEDIA_WORKER_CONCURRENCY` (mặc định `3`)
- Job timeout: `10 minutes`
- Retries: `5`
- Exponential backoff: `2s`, `4s`, `8s`, `16s`, `32s`
- Logs queue metrics every 30 seconds

Queue state sống trong memory của worker process — không dùng Redis hay Bull/BullMQ cho queue chính.

---

## Processing Rules

### Image (`ImageProcessor` + Sharp)

- Đọc metadata với Sharp
- Auto-rotate theo EXIF orientation
- Strip EXIF data (privacy)
- Generate 2 variants:

| Variant | Kích thước | Format | Quality |
|---------|-----------|--------|---------|
| `thumb` | 320px width | WebP | 70% |
| `preview` | 1280px width | WebP | 75% |

`MediaProcessorService` upload variants lên MinIO, lưu variant entries, `thumbKey`, image metadata (`width`, `height`, `format`), đặt status `READY`, publish `media.ready`.

### Video (`VideoProcessor` + fluent-ffmpeg)

- Đọc metadata bằng ffprobe
- Generate poster frame tại `min(1 giây, 10% duration)`
- Generate 2 MP4 variants:

| Profile | Resolution | CRF | Preset | Audio |
|---------|-----------|-----|--------|-------|
| `mp4_720p` | 720p | 23 | veryfast | 128k |
| `mp4_360p` | 360p | 26 | veryfast | 96k |

FFmpeg flags: `+faststart` cho progressive playback. Thread count từ `FFMPEG_THREADS` (mặc định 2). Nice level từ `FFMPEG_NICE_LEVEL` (mặc định 10).

`MediaProcessorService` upload poster và variants, lưu metadata, đặt status `READY`, publish `media.ready`.

### Audio và File

Short-circuit — không xử lý:
- Không dùng Sharp hay FFmpeg
- Status → `READY` ngay lập tức
- **Không** publish `media.ready` (không có derived media state để sync)

Điều này quan trọng với clients và Message Store: audio/file attachments không có variants để chờ.

---

## Failure và Recovery

### Per-job retry

Khi xử lý thất bại:
- Job giữ trong memory
- Retry tối đa 5 lần với exponential backoff
- Sau lần retry cuối: publish `media.failed`, MongoDB status → `FAILED`

### Recovery cron (`MediaRecoveryService`)

Chạy mỗi 5 phút. Dùng Redis leader lock `media-worker:recovery:leader` để đảm bảo chỉ 1 replica chạy recovery tại một thời điểm.

Xử lý 3 loại:
- Items `PROCESSING` stuck: re-enqueue
- Items `FAILED`: re-enqueue
- Items `DELETION_PENDING`: retry MinIO deletion trực tiếp → `DELETED` khi thành công

Không dùng Kafka retry topic — recovery hoàn toàn qua cron job này.

---

## Kafka

### Consumed

- `media.uploaded`

### Produced

- `media.ready`
- `media.failed`

`media.ready` payload includes processed metadata needed by downstream attachment sync:

- `mediaId`
- `ownerId`
- `type`
- `thumbKey`
- `variants`
- `meta`

`media.failed` includes:

- `mediaId`
- `ownerId`
- `error`

---

## Resource Control

Worker cố ý tránh CPU thrash:

- Queue concurrency capped bởi `MEDIA_WORKER_CONCURRENCY` (mặc định `3`)
- FFmpeg thread count capped bởi `FFMPEG_THREADS` (mặc định `2`)
- FFmpeg nice level capped bởi `FFMPEG_NICE_LEVEL` (mặc định `10` — lower priority)
- Node.js heap cap: `NODE_OPTIONS=--max-old-space-size=512`

Thiết kế: Kafka ack nhanh → CPU-heavy work chỉ chạy trong bounded queue → nhiều worker replicas scale horizontally qua cùng Kafka consumer group.

### KEDA Scaling

Media Worker hỗ trợ KEDA (Kubernetes Event-Driven Autoscaling) với Kafka lag trigger: khi consumer lag của group `nest-chat.media-worker` trên topic `media.uploaded` vượt ngưỡng, KEDA tự động scale số worker replicas.

---

## Boundaries

Media Worker does not:

- issue access URLs
- authorize media access
- expose APIs to clients
- persist upload sessions
- notify WebSocket clients directly

Downstream flow after success or failure is:

- Media Worker publishes `media.ready` / `media.failed`
- Message Store updates the related attachment
- Realtime Gateway emits `message:media_ready` when relevant
