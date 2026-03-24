typedef unsigned char uint8_t;
typedef unsigned int uint32_t;

typedef struct DecoderFrameMeta {
  int width;
  int height;
  int pix_fmt;
  int pts;
  int stride_y;
  int stride_u;
  int stride_v;
  int offset_y;
  int offset_u;
  int offset_v;
} DecoderFrameMeta;

static uint8_t heap[1 << 20];
static uint32_t heap_offset = 8;
static DecoderFrameMeta frame_meta = {0};

__attribute__((export_name("malloc")))
int wasm_malloc(int size) {
  uint32_t ptr = heap_offset;
  heap_offset = (heap_offset + (uint32_t)size + 7U) & ~7U;
  if (heap_offset >= sizeof(heap)) {
    return 0;
  }
  return (int)ptr;
}

__attribute__((export_name("free")))
void wasm_free(int ptr) {
  (void)ptr;
}

__attribute__((export_name("decoder_open")))
int decoder_open(int extradata_ptr, int extradata_len) {
  (void)extradata_ptr;
  (void)extradata_len;
  return 0;
}

__attribute__((export_name("decoder_send_packet")))
int decoder_send_packet(int packet_ptr, int packet_len, int dts, int pts, int is_key) {
  (void)packet_ptr;
  (void)packet_len;
  (void)dts;
  (void)pts;
  (void)is_key;
  return 0;
}

__attribute__((export_name("decoder_receive_frame")))
int decoder_receive_frame(void) {
  return 1;
}

__attribute__((export_name("decoder_get_frame_meta")))
int decoder_get_frame_meta(void) {
  return (int)(unsigned long)&frame_meta;
}

__attribute__((export_name("decoder_flush")))
int decoder_flush(void) {
  return 0;
}

__attribute__((export_name("decoder_close")))
void decoder_close(void) {
}
