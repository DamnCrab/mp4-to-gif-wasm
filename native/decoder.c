#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>

#include <libavcodec/avcodec.h>
#include <libavfilter/avfilter.h>
#include <libavfilter/buffersink.h>
#include <libavfilter/buffersrc.h>
#include <libavutil/imgutils.h>
#include <libavutil/mem.h>
#include <libavutil/pixdesc.h>
#include <libswscale/swscale.h>

#define GIF_MAX_COLORS 256

typedef struct DecoderFrameMeta {
  int32_t width;
  int32_t height;
  int32_t pix_fmt;
  int32_t pts;
  int32_t stride_y;
  int32_t stride_u;
  int32_t stride_v;
  int32_t offset_y;
  int32_t offset_u;
  int32_t offset_v;
} DecoderFrameMeta;

typedef struct GifStoredFrame {
  uint8_t *rgba;
} GifStoredFrame;

typedef struct GifWriter {
  uint8_t *output;
  int output_size;
  int output_capacity;
  uint8_t *index_buffer;
  int index_buffer_size;
  uint8_t *lzw_buffer;
  int lzw_buffer_size;
  int lzw_buffer_capacity;
  GifStoredFrame *frames;
  int frame_capacity;
  int frame_count;
  int width;
  int height;
  int delay_cs;
  int max_colors;
  int table_size;
  int min_code_size;
  struct SwsContext *rgba_scale_ctx;
  struct SwsContext *palette_rgba_ctx;
} GifWriter;

static AVCodecContext *decoder_ctx = NULL;
static AVFrame *frame = NULL;
static DecoderFrameMeta frame_meta;
static uint8_t *frame_buffer = NULL;
static int frame_buffer_size = 0;
static GifWriter gif_writer = {0};

void *malloc(size_t size) {
  return av_malloc(size);
}

void free(void *ptr) {
  av_free(ptr);
}

static int next_power_of_two(int value) {
  int power = 1;
  while (power < value && power < GIF_MAX_COLORS) {
    power <<= 1;
  }
  return power > GIF_MAX_COLORS ? GIF_MAX_COLORS : power;
}

static int ceil_log2_int(int value) {
  int bits = 0;
  int current = 1;
  while (current < value) {
    current <<= 1;
    bits += 1;
  }
  return bits;
}

static int ensure_frame_buffer(int width, int height) {
  int needed = av_image_get_buffer_size(AV_PIX_FMT_YUV420P, width, height, 1);
  if (needed < 0) {
    return needed;
  }
  if (needed <= frame_buffer_size) {
    return 0;
  }

  uint8_t *next = av_realloc(frame_buffer, needed);
  if (next == NULL) {
    return AVERROR(ENOMEM);
  }
  frame_buffer = next;
  frame_buffer_size = needed;
  return 0;
}

static int ensure_output_capacity(int additional) {
  int needed = gif_writer.output_size + additional;
  if (needed <= gif_writer.output_capacity) {
    return 0;
  }

  int capacity = gif_writer.output_capacity > 0 ? gif_writer.output_capacity : 1024;
  while (capacity < needed) {
    capacity *= 2;
  }

  uint8_t *next = av_realloc(gif_writer.output, capacity);
  if (next == NULL) {
    return AVERROR(ENOMEM);
  }
  gif_writer.output = next;
  gif_writer.output_capacity = capacity;
  return 0;
}

static int append_bytes(const uint8_t *data, int length) {
  int rc = ensure_output_capacity(length);
  if (rc < 0) {
    return rc;
  }
  memcpy(gif_writer.output + gif_writer.output_size, data, (size_t)length);
  gif_writer.output_size += length;
  return 0;
}

static int append_u8(uint8_t value) {
  return append_bytes(&value, 1);
}

static int append_u16le(int value) {
  uint8_t bytes[2];
  bytes[0] = (uint8_t)(value & 0xff);
  bytes[1] = (uint8_t)((value >> 8) & 0xff);
  return append_bytes(bytes, 2);
}

static int ensure_index_capacity(void) {
  int needed = gif_writer.width * gif_writer.height;
  if (needed <= gif_writer.index_buffer_size) {
    return 0;
  }

  uint8_t *next = av_realloc(gif_writer.index_buffer, needed);
  if (next == NULL) {
    return AVERROR(ENOMEM);
  }
  gif_writer.index_buffer = next;
  gif_writer.index_buffer_size = needed;
  return 0;
}

static int ensure_lzw_capacity(int needed) {
  if (needed <= gif_writer.lzw_buffer_capacity) {
    return 0;
  }

  int capacity = gif_writer.lzw_buffer_capacity > 0 ? gif_writer.lzw_buffer_capacity : 1024;
  while (capacity < needed) {
    capacity *= 2;
  }

  uint8_t *next = av_realloc(gif_writer.lzw_buffer, capacity);
  if (next == NULL) {
    return AVERROR(ENOMEM);
  }
  gif_writer.lzw_buffer = next;
  gif_writer.lzw_buffer_capacity = capacity;
  return 0;
}

static int ensure_frame_capacity(void) {
  if (gif_writer.frame_count < gif_writer.frame_capacity) {
    return 0;
  }

  int capacity = gif_writer.frame_capacity > 0 ? gif_writer.frame_capacity * 2 : 16;
  GifStoredFrame *next = av_realloc(gif_writer.frames, (size_t)capacity * sizeof(GifStoredFrame));
  if (next == NULL) {
    return AVERROR(ENOMEM);
  }

  memset(next + gif_writer.frame_capacity, 0, (size_t)(capacity - gif_writer.frame_capacity) * sizeof(GifStoredFrame));
  gif_writer.frames = next;
  gif_writer.frame_capacity = capacity;
  return 0;
}

static int write_lzw_image_data(const uint8_t *indices, int pixel_count) {
  int clear_code = 1 << gif_writer.min_code_size;
  int end_code = clear_code + 1;
  int code_size = gif_writer.min_code_size + 1;
  int threshold = 1 << code_size;
  int next_code = end_code + 1;
  int bit_position = 0;
  int rc = ensure_lzw_capacity((pixel_count * 3) + 512);
  if (rc < 0) {
    return rc;
  }

  memset(gif_writer.lzw_buffer, 0, (size_t)gif_writer.lzw_buffer_capacity);
  gif_writer.lzw_buffer_size = 0;

  #define EMIT_CODE(value) \
    do { \
      uint32_t code_value = (uint32_t)(value); \
      int start_byte = bit_position >> 3; \
      int needed_bytes = start_byte + 3; \
      if (needed_bytes > gif_writer.lzw_buffer_capacity) { \
        int grow_rc = ensure_lzw_capacity(needed_bytes + 1024); \
        if (grow_rc < 0) { \
          return grow_rc; \
        } \
      } \
      gif_writer.lzw_buffer[start_byte] |= (uint8_t)((code_value << (bit_position & 7)) & 0xff); \
      gif_writer.lzw_buffer[start_byte + 1] |= (uint8_t)((code_value >> (8 - (bit_position & 7))) & 0xff); \
      gif_writer.lzw_buffer[start_byte + 2] |= (uint8_t)((code_value >> (16 - (bit_position & 7))) & 0xff); \
      bit_position += code_size; \
      gif_writer.lzw_buffer_size = (bit_position + 7) >> 3; \
    } while (0)

  if (pixel_count <= 0) {
    return AVERROR(EINVAL);
  }

  EMIT_CODE(clear_code);
  EMIT_CODE(indices[0]);

  for (int i = 1; i < pixel_count; i += 1) {
    if (next_code == threshold - 1) {
      EMIT_CODE(clear_code);
      code_size = gif_writer.min_code_size + 1;
      threshold = 1 << code_size;
      next_code = end_code + 1;
      EMIT_CODE(indices[i]);
      continue;
    }

    EMIT_CODE(indices[i]);
    next_code += 1;
  }

  EMIT_CODE(end_code);

  #undef EMIT_CODE

  rc = append_u8((uint8_t)gif_writer.min_code_size);
  if (rc < 0) {
    return rc;
  }

  for (int offset = 0; offset < gif_writer.lzw_buffer_size; offset += 255) {
    int chunk = gif_writer.lzw_buffer_size - offset;
    if (chunk > 255) {
      chunk = 255;
    }
    rc = append_u8((uint8_t)chunk);
    if (rc < 0) {
      return rc;
    }
    rc = append_bytes(gif_writer.lzw_buffer + offset, chunk);
    if (rc < 0) {
      return rc;
    }
  }

  return append_u8(0);
}

static AVFrame *alloc_owned_rgba_frame(const uint8_t *rgba, int pts) {
  AVFrame *out = av_frame_alloc();
  if (out == NULL) {
    return NULL;
  }

  out->format = AV_PIX_FMT_RGBA;
  out->width = gif_writer.width;
  out->height = gif_writer.height;
  out->pts = pts;

  if (av_frame_get_buffer(out, 1) < 0) {
    av_frame_free(&out);
    return NULL;
  }
  if (av_frame_make_writable(out) < 0) {
    av_frame_free(&out);
    return NULL;
  }

  for (int y = 0; y < gif_writer.height; y += 1) {
    memcpy(out->data[0] + (y * out->linesize[0]), rgba + (y * gif_writer.width * 4), (size_t)gif_writer.width * 4);
  }

  return out;
}

static int write_global_palette_header(const AVFrame *palette_frame) {
  int rc;
  uint8_t header[6] = {'G', 'I', 'F', '8', '9', 'a'};
  uint8_t netscape_ext[] = {
      0x21, 0xff, 0x0b,
      'N', 'E', 'T', 'S', 'C', 'A', 'P', 'E', '2', '.', '0',
      0x03, 0x01, 0x00, 0x00, 0x00};
  uint8_t palette_bytes[GIF_MAX_COLORS * 3];
  uint8_t rgba_palette[16 * 16 * 4];

  gif_writer.palette_rgba_ctx = sws_getCachedContext(
      gif_writer.palette_rgba_ctx,
      palette_frame->width,
      palette_frame->height,
      palette_frame->format,
      16,
      16,
      AV_PIX_FMT_RGBA,
      SWS_BILINEAR,
      NULL,
      NULL,
      NULL);
  if (gif_writer.palette_rgba_ctx == NULL) {
    return AVERROR(ENOMEM);
  }

  {
    uint8_t *dst_data[4] = {rgba_palette, NULL, NULL, NULL};
    int dst_linesize[4] = {16 * 4, 0, 0, 0};
    sws_scale(
        gif_writer.palette_rgba_ctx,
        (const uint8_t *const *)palette_frame->data,
        palette_frame->linesize,
        0,
        palette_frame->height,
        dst_data,
        dst_linesize);
  }

  memset(palette_bytes, 0, sizeof(palette_bytes));
  for (int i = 0; i < gif_writer.table_size; i += 1) {
    const uint8_t *entry = rgba_palette + (i * 4);
    palette_bytes[i * 3] = entry[0];
    palette_bytes[i * 3 + 1] = entry[1];
    palette_bytes[i * 3 + 2] = entry[2];
  }

  rc = append_bytes(header, 6);
  if (rc < 0) {
    return rc;
  }
  rc = append_u16le(gif_writer.width);
  if (rc < 0) {
    return rc;
  }
  rc = append_u16le(gif_writer.height);
  if (rc < 0) {
    return rc;
  }
  rc = append_u8((uint8_t)(0x80 | (7 << 4) | (ceil_log2_int(gif_writer.table_size) - 1)));
  if (rc < 0) {
    return rc;
  }
  rc = append_u8(0);
  if (rc < 0) {
    return rc;
  }
  rc = append_u8(0);
  if (rc < 0) {
    return rc;
  }
  rc = append_bytes(palette_bytes, gif_writer.table_size * 3);
  if (rc < 0) {
    return rc;
  }
  return append_bytes(netscape_ext, sizeof(netscape_ext));
}

static int write_pal8_frame(const AVFrame *pal8_frame) {
  int rc = ensure_index_capacity();
  if (rc < 0) {
    return rc;
  }

  for (int y = 0; y < gif_writer.height; y += 1) {
    memcpy(
        gif_writer.index_buffer + (y * gif_writer.width),
        pal8_frame->data[0] + (y * pal8_frame->linesize[0]),
        (size_t)gif_writer.width);
  }

  {
    uint8_t gce[8] = {0x21, 0xf9, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00};
    uint8_t image_descriptor[10] = {0x2c, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00};

    gce[4] = (uint8_t)(gif_writer.delay_cs & 0xff);
    gce[5] = (uint8_t)((gif_writer.delay_cs >> 8) & 0xff);
    image_descriptor[5] = (uint8_t)(gif_writer.width & 0xff);
    image_descriptor[6] = (uint8_t)((gif_writer.width >> 8) & 0xff);
    image_descriptor[7] = (uint8_t)(gif_writer.height & 0xff);
    image_descriptor[8] = (uint8_t)((gif_writer.height >> 8) & 0xff);

    rc = append_bytes(gce, sizeof(gce));
    if (rc < 0) {
      return rc;
    }
    rc = append_bytes(image_descriptor, sizeof(image_descriptor));
    if (rc < 0) {
      return rc;
    }
  }

  return write_lzw_image_data(gif_writer.index_buffer, gif_writer.width * gif_writer.height);
}

static int create_buffer_filter(
    AVFilterGraph *graph,
    AVFilterContext **ctx,
    const char *name,
    enum AVPixelFormat pix_fmt,
    int width,
    int height,
    int time_base_num,
    int time_base_den) {
  char args[256];
  snprintf(
      args,
      sizeof(args),
      "video_size=%dx%d:pix_fmt=%d:time_base=%d/%d:pixel_aspect=1/1",
      width,
      height,
      pix_fmt,
      time_base_num,
      time_base_den);
  return avfilter_graph_create_filter(ctx, avfilter_get_by_name("buffer"), name, args, NULL, graph);
}

static int build_palette_frame(AVFrame **palette_frame_out) {
  AVFilterGraph *graph = NULL;
  AVFilterContext *src = NULL;
  AVFilterContext *palettegen = NULL;
  AVFilterContext *sink = NULL;
  AVFrame *palette_frame = NULL;
  char palettegen_args[64];
  int rc = 0;

  graph = avfilter_graph_alloc();
  if (graph == NULL) {
    return AVERROR(ENOMEM);
  }

  rc = create_buffer_filter(graph, &src, "src", AV_PIX_FMT_RGBA, gif_writer.width, gif_writer.height, 1, 100);
  if (rc < 0) {
    goto end;
  }

  snprintf(palettegen_args, sizeof(palettegen_args), "stats_mode=diff:max_colors=%d", gif_writer.max_colors);
  rc = avfilter_graph_create_filter(&palettegen, avfilter_get_by_name("palettegen"), "palettegen", palettegen_args, NULL, graph);
  if (rc < 0) {
    goto end;
  }
  rc = avfilter_graph_create_filter(&sink, avfilter_get_by_name("buffersink"), "sink", NULL, NULL, graph);
  if (rc < 0) {
    goto end;
  }

  rc = avfilter_link(src, 0, palettegen, 0);
  if (rc < 0) {
    goto end;
  }
  rc = avfilter_link(palettegen, 0, sink, 0);
  if (rc < 0) {
    goto end;
  }
  rc = avfilter_graph_config(graph, NULL);
  if (rc < 0) {
    goto end;
  }

  for (int i = 0; i < gif_writer.frame_count; i += 1) {
    AVFrame *rgba_frame = alloc_owned_rgba_frame(gif_writer.frames[i].rgba, i);
    if (rgba_frame == NULL) {
      rc = AVERROR(ENOMEM);
      goto end;
    }
    rc = av_buffersrc_add_frame_flags(src, rgba_frame, 0);
    av_frame_free(&rgba_frame);
    if (rc < 0) {
      goto end;
    }
  }

  rc = av_buffersrc_add_frame_flags(src, NULL, 0);
  if (rc < 0) {
    goto end;
  }

  palette_frame = av_frame_alloc();
  if (palette_frame == NULL) {
    rc = AVERROR(ENOMEM);
    goto end;
  }

  rc = av_buffersink_get_frame(sink, palette_frame);
  if (rc < 0) {
    goto end;
  }

  *palette_frame_out = palette_frame;
  palette_frame = NULL;
  rc = 0;

end:
  if (palette_frame != NULL) {
    av_frame_free(&palette_frame);
  }
  if (graph != NULL) {
    avfilter_graph_free(&graph);
  }
  return rc;
}

static int emit_paletted_frames(const AVFrame *palette_frame) {
  AVFilterGraph *graph = NULL;
  AVFilterContext *src = NULL;
  AVFilterContext *palette_src = NULL;
  AVFilterContext *paletteuse = NULL;
  AVFilterContext *sink = NULL;
  AVFrame *pal8_frame = NULL;
  int rc = 0;

  graph = avfilter_graph_alloc();
  if (graph == NULL) {
    return AVERROR(ENOMEM);
  }

  rc = create_buffer_filter(graph, &src, "src", AV_PIX_FMT_RGBA, gif_writer.width, gif_writer.height, 1, 100);
  if (rc < 0) {
    goto end;
  }
  rc = create_buffer_filter(graph, &palette_src, "palette", palette_frame->format, palette_frame->width, palette_frame->height, 1, 1);
  if (rc < 0) {
    goto end;
  }
  rc = avfilter_graph_create_filter(
      &paletteuse,
      avfilter_get_by_name("paletteuse"),
      "paletteuse",
      "dither=bayer:bayer_scale=3:diff_mode=rectangle",
      NULL,
      graph);
  if (rc < 0) {
    goto end;
  }
  rc = avfilter_graph_create_filter(&sink, avfilter_get_by_name("buffersink"), "sink", NULL, NULL, graph);
  if (rc < 0) {
    goto end;
  }

  rc = avfilter_link(src, 0, paletteuse, 0);
  if (rc < 0) {
    goto end;
  }
  rc = avfilter_link(palette_src, 0, paletteuse, 1);
  if (rc < 0) {
    goto end;
  }
  rc = avfilter_link(paletteuse, 0, sink, 0);
  if (rc < 0) {
    goto end;
  }
  rc = avfilter_graph_config(graph, NULL);
  if (rc < 0) {
    goto end;
  }

  rc = av_buffersrc_add_frame_flags(palette_src, (AVFrame *)palette_frame, AV_BUFFERSRC_FLAG_KEEP_REF);
  if (rc < 0) {
    goto end;
  }
  rc = av_buffersrc_add_frame_flags(palette_src, NULL, 0);
  if (rc < 0) {
    goto end;
  }

  pal8_frame = av_frame_alloc();
  if (pal8_frame == NULL) {
    rc = AVERROR(ENOMEM);
    goto end;
  }

  for (int i = 0; i < gif_writer.frame_count; i += 1) {
    AVFrame *rgba_frame = alloc_owned_rgba_frame(gif_writer.frames[i].rgba, i);
    if (rgba_frame == NULL) {
      rc = AVERROR(ENOMEM);
      goto end;
    }
    rc = av_buffersrc_add_frame_flags(src, rgba_frame, 0);
    av_frame_free(&rgba_frame);
    if (rc < 0) {
      goto end;
    }

    rc = av_buffersink_get_frame(sink, pal8_frame);
    if (rc < 0) {
      goto end;
    }
    rc = write_pal8_frame(pal8_frame);
    av_frame_unref(pal8_frame);
    if (rc < 0) {
      goto end;
    }
  }

  rc = append_u8(0x3b);

end:
  if (pal8_frame != NULL) {
    av_frame_free(&pal8_frame);
  }
  if (graph != NULL) {
    avfilter_graph_free(&graph);
  }
  return rc;
}

static void gif_encoder_reset(void) {
  if (gif_writer.output != NULL) {
    av_free(gif_writer.output);
  }
  if (gif_writer.index_buffer != NULL) {
    av_free(gif_writer.index_buffer);
  }
  if (gif_writer.lzw_buffer != NULL) {
    av_free(gif_writer.lzw_buffer);
  }
  if (gif_writer.frames != NULL) {
    for (int i = 0; i < gif_writer.frame_count; i += 1) {
      if (gif_writer.frames[i].rgba != NULL) {
        av_free(gif_writer.frames[i].rgba);
      }
    }
    av_free(gif_writer.frames);
  }
  if (gif_writer.rgba_scale_ctx != NULL) {
    sws_freeContext(gif_writer.rgba_scale_ctx);
  }
  if (gif_writer.palette_rgba_ctx != NULL) {
    sws_freeContext(gif_writer.palette_rgba_ctx);
  }
  memset(&gif_writer, 0, sizeof(gif_writer));
}

int gif_encoder_open(int width, int height, int delay_cs, int max_colors) {
  if (width <= 0 || height <= 0) {
    return AVERROR(EINVAL);
  }

  if (max_colors < 2) {
    max_colors = 2;
  }
  if (max_colors > GIF_MAX_COLORS) {
    max_colors = GIF_MAX_COLORS;
  }

  gif_encoder_reset();
  gif_writer.width = width;
  gif_writer.height = height;
  gif_writer.delay_cs = delay_cs > 0 ? delay_cs : 1;
  gif_writer.max_colors = max_colors;
  gif_writer.table_size = next_power_of_two(max_colors);
  gif_writer.min_code_size = ceil_log2_int(gif_writer.table_size);
  if (gif_writer.min_code_size < 2) {
    gif_writer.min_code_size = 2;
  }

  return 0;
}

int gif_encoder_add_frame(
    int src_width,
    int src_height,
    int stride_y,
    int stride_u,
    int stride_v,
    int plane_y_ptr,
    int plane_u_ptr,
    int plane_v_ptr) {
  uint8_t *rgba = NULL;
  const uint8_t *src_data[4];
  int src_linesize[4];
  uint8_t *dst_data[4];
  int dst_linesize[4];
  int rc = ensure_frame_capacity();
  if (rc < 0) {
    return rc;
  }

  gif_writer.rgba_scale_ctx = sws_getCachedContext(
      gif_writer.rgba_scale_ctx,
      src_width,
      src_height,
      AV_PIX_FMT_YUV420P,
      gif_writer.width,
      gif_writer.height,
      AV_PIX_FMT_RGBA,
      SWS_LANCZOS,
      NULL,
      NULL,
      NULL);
  if (gif_writer.rgba_scale_ctx == NULL) {
    return AVERROR(ENOMEM);
  }

  rgba = av_malloc((size_t)gif_writer.width * gif_writer.height * 4);
  if (rgba == NULL) {
    return AVERROR(ENOMEM);
  }

  src_data[0] = (const uint8_t *)(intptr_t)plane_y_ptr;
  src_data[1] = (const uint8_t *)(intptr_t)plane_u_ptr;
  src_data[2] = (const uint8_t *)(intptr_t)plane_v_ptr;
  src_data[3] = NULL;
  src_linesize[0] = stride_y;
  src_linesize[1] = stride_u;
  src_linesize[2] = stride_v;
  src_linesize[3] = 0;

  dst_data[0] = rgba;
  dst_data[1] = NULL;
  dst_data[2] = NULL;
  dst_data[3] = NULL;
  dst_linesize[0] = gif_writer.width * 4;
  dst_linesize[1] = 0;
  dst_linesize[2] = 0;
  dst_linesize[3] = 0;

  sws_scale(
      gif_writer.rgba_scale_ctx,
      src_data,
      src_linesize,
      0,
      src_height,
      dst_data,
      dst_linesize);

  gif_writer.frames[gif_writer.frame_count].rgba = rgba;
  gif_writer.frame_count += 1;
  return 0;
}

int gif_encoder_finish(void) {
  AVFrame *palette_frame = NULL;
  int rc;

  if (gif_writer.frame_count <= 0) {
    return AVERROR(EINVAL);
  }

  rc = build_palette_frame(&palette_frame);
  if (rc < 0) {
    goto end;
  }
  rc = write_global_palette_header(palette_frame);
  if (rc < 0) {
    goto end;
  }
  rc = emit_paletted_frames(palette_frame);

end:
  if (palette_frame != NULL) {
    av_frame_free(&palette_frame);
  }
  return rc;
}

int gif_encoder_get_output_ptr(void) {
  return (int)(intptr_t)gif_writer.output;
}

int gif_encoder_get_output_size(void) {
  return gif_writer.output_size;
}

void gif_encoder_close(void) {
  gif_encoder_reset();
}

int decoder_open(int extradata_ptr, int extradata_len) {
  const AVCodec *codec = avcodec_find_decoder(AV_CODEC_ID_H264);
  if (codec == NULL) {
    return AVERROR_DECODER_NOT_FOUND;
  }

  decoder_ctx = avcodec_alloc_context3(codec);
  if (decoder_ctx == NULL) {
    return AVERROR(ENOMEM);
  }

  decoder_ctx->thread_count = 1;
  decoder_ctx->pkt_timebase.num = 1;
  decoder_ctx->pkt_timebase.den = 1000;

  decoder_ctx->extradata = av_malloc((size_t)extradata_len + AV_INPUT_BUFFER_PADDING_SIZE);
  if (decoder_ctx->extradata == NULL) {
    return AVERROR(ENOMEM);
  }
  decoder_ctx->extradata_size = extradata_len;
  memcpy(decoder_ctx->extradata, (void *)(intptr_t)extradata_ptr, (size_t)extradata_len);
  memset(decoder_ctx->extradata + extradata_len, 0, AV_INPUT_BUFFER_PADDING_SIZE);

  {
    int rc = avcodec_open2(decoder_ctx, codec, NULL);
    if (rc < 0) {
      return rc;
    }
  }

  frame = av_frame_alloc();
  if (frame == NULL) {
    return AVERROR(ENOMEM);
  }

  return 0;
}

int decoder_send_packet(int packet_ptr, int packet_len, int dts, int pts, int is_key) {
  AVPacket *packet = av_packet_alloc();
  if (packet == NULL) {
    return AVERROR(ENOMEM);
  }

  {
    int rc = av_new_packet(packet, packet_len);
    if (rc < 0) {
      av_packet_free(&packet);
      return rc;
    }

    memcpy(packet->data, (void *)(intptr_t)packet_ptr, (size_t)packet_len);
    packet->dts = dts;
    packet->pts = pts;
    if (is_key) {
      packet->flags |= AV_PKT_FLAG_KEY;
    }

    rc = avcodec_send_packet(decoder_ctx, packet);
    av_packet_free(&packet);
    return rc;
  }
}

int decoder_receive_frame(void) {
  int rc = avcodec_receive_frame(decoder_ctx, frame);
  if (rc == AVERROR(EAGAIN) || rc == AVERROR_EOF) {
    return 1;
  }
  if (rc < 0) {
    return rc;
  }

  if (frame->format != AV_PIX_FMT_YUV420P) {
    return AVERROR_PATCHWELCOME;
  }

  rc = ensure_frame_buffer(frame->width, frame->height);
  if (rc < 0) {
    return rc;
  }

  rc = av_image_copy_to_buffer(
      frame_buffer,
      frame_buffer_size,
      (const uint8_t *const *)frame->data,
      frame->linesize,
      AV_PIX_FMT_YUV420P,
      frame->width,
      frame->height,
      1);
  if (rc < 0) {
    return rc;
  }

  {
    int y_size = frame->width * frame->height;
    int uv_width = (frame->width + 1) / 2;
    int uv_height = (frame->height + 1) / 2;
    int u_size = uv_width * uv_height;

    frame_meta.width = frame->width;
    frame_meta.height = frame->height;
    frame_meta.pix_fmt = 0;
    frame_meta.pts = (int32_t)frame->pts;
    frame_meta.stride_y = frame->width;
    frame_meta.stride_u = uv_width;
    frame_meta.stride_v = uv_width;
    frame_meta.offset_y = (int32_t)(intptr_t)frame_buffer;
    frame_meta.offset_u = (int32_t)(intptr_t)(frame_buffer + y_size);
    frame_meta.offset_v = (int32_t)(intptr_t)(frame_buffer + y_size + u_size);
  }

  av_frame_unref(frame);
  return 0;
}

int decoder_get_frame_meta(void) {
  return (int)(intptr_t)&frame_meta;
}

int decoder_flush(void) {
  return avcodec_send_packet(decoder_ctx, NULL);
}

void decoder_close(void) {
  if (frame != NULL) {
    av_frame_free(&frame);
  }
  if (decoder_ctx != NULL) {
    avcodec_free_context(&decoder_ctx);
  }
  if (frame_buffer != NULL) {
    av_free(frame_buffer);
    frame_buffer = NULL;
    frame_buffer_size = 0;
  }
  gif_encoder_reset();
}
