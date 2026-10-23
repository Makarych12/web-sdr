/* RX adapter for kgoba/ft8_lib, MIT, upstream commit
 * 9fec6ca39886edbf96f4f5e71edc76da5074e871.
 * Build (Emscripten 6.0.13), from repository root:
 * emcc -O3 -Ivendor/ft8_lib vendor/ft8_lib/rx.c vendor/ft8_lib/ft8/*.c
 * vendor/ft8_lib/common/monitor.c vendor/ft8_lib/fft/*.c -lm
 * -sMODULARIZE -sEXPORT_ES6 -sENVIRONMENT=worker -sFILESYSTEM=0
 * -sEXPORTED_FUNCTIONS='["_rx_decode","_rx_input","_rx_output"]'
 * -sEXPORTED_RUNTIME_METHODS='["HEAPF32","UTF8ToString"]'
 * -sINITIAL_MEMORY=16777216 -sSTACK_SIZE=1048576 -o public/ft8/core.js
 * No encoder entry point is exposed; tone re-encoding is only for RX SNR.
 */
#include <stdio.h>
#include <math.h>
#include <stdlib.h>
#include <ft8/encode.h>
#include <string.h>
#include <common/monitor.h>
#include <ft8/message.h>
static float input[180000];
static char output[32768];
float* rx_input(void) { return input; }
char* rx_output(void) { return output; }
/* Bounded callsign hash cache, kept across RX slots. */
static struct { char call[12]; uint32_t hash; } calls[256];
static unsigned cursor;
static void save_hash(const char* call, uint32_t hash) {
    for(int i=0;i<256;i++) if(calls[i].call[0] && calls[i].hash==hash) return;
    unsigned i=cursor++%256; strncpy(calls[i].call,call,11); calls[i].call[11]=0;calls[i].hash=hash;
}
static bool lookup_hash(ftx_callsign_hash_type_t type,uint32_t hash,char* call) {
    int shift=type==FTX_CALLSIGN_HASH_10_BITS?12:type==FTX_CALLSIGN_HASH_12_BITS?10:0;
    for(int i=0;i<256;i++) if(calls[i].call[0] && (calls[i].hash>>shift)==hash){strcpy(call,calls[i].call);return true;}
    return false;
}
static ftx_callsign_hash_interface_t hashes={.lookup_hash=lookup_hash,.save_hash=save_hash};
static int compare(const void* a,const void* b){float x=*(const float*)a,y=*(const float*)b;return (x>y)-(x<y);}
/* Approximate received SNR in a 2500 Hz reference bandwidth. Decode the
 * validated payload back to tone indices to measure signal-bin power, rather
 * than using the Costas score as SNR. Local median noise rejects narrow
 * interferers. Hann ENBW = 1.5 / (2 * 0.16) Hz. GFSK transitions, overlapping
 * signals and quantized magnitudes limit accuracy; this is not WSJT-X SNR. */
static float estimate_snr(const monitor_t* mon,const ftx_candidate_t* c,const ftx_message_t* msg){
    uint8_t tones[79];ft8_encode(msg->payload,tones);
    const ftx_waterfall_t* w=&mon->wf;double signal=0,noise=0;
    for(int k=0;k<79;k++){
        int block=c->time_offset+k;if(block<0||block>=w->num_blocks)continue;
        const WF_ELEM_T* row=w->mag+block*w->block_stride+(c->time_sub*w->freq_osr+c->freq_sub)*w->num_bins;
        float bins[40];int n=0;
        for(int d=-24;d<=31;d++){
            if(d>-8&&d<15)continue;
            int f=c->freq_offset+d;if(f>=0&&f<w->num_bins)bins[n++]=powf(10,WF_ELEM_MAG(row[f])/10);
        }
        if(n<4)continue;
        qsort(bins,n,sizeof(float),compare);
        /* Median power of exponential noise = mean * ln(2). */
        double floor=bins[n/2]/0.693147;
        noise+=floor;signal+=powf(10,WF_ELEM_MAG(row[c->freq_offset+tones[k]])/10);
    }
    double ratio=noise>0?signal/noise-1:0;
    return ratio>0?10*log10(ratio*4.6875/2500):-50;
}
int rx_decode(int count) {
    monitor_t mon;
    monitor_config_t cfg = { .f_min=100, .f_max=3000, .sample_rate=12000,
        .time_osr=2, .freq_osr=2, .protocol=FTX_PROTOCOL_FT8 };
    monitor_init(&mon, &cfg);
    if (count>180000) count=180000;
    for(int p=0;p+mon.block_size<=count;p+=mon.block_size) monitor_process(&mon,input+p);
    ftx_candidate_t candidates[140];
    int n=ftx_find_candidates(&mon.wf,140,candidates,10), used=1, total=0;
    ftx_message_t seen[140];
    output[0]='[';
    for(int i=0;i<n;i++) {
        ftx_message_t message; ftx_decode_status_t status;
        if(!ftx_decode_candidate(&mon.wf,&candidates[i],30,&message,&status) ||
           status.ldpc_errors || status.crc_calculated!=status.crc_extracted) continue;
        int duplicate=0;
        for(int j=0;j<total;j++) if(!memcmp(seen[j].payload,message.payload,sizeof(message.payload))) duplicate=1;
        if(duplicate) continue;
        char text[FTX_MAX_MESSAGE_LENGTH]; ftx_message_offsets_t offsets;
        if(ftx_message_decode(&message,&hashes,text,&offsets)!=FTX_MESSAGE_RC_OK) continue;
        seen[total++]=message;
        /* FT8 message alphabet has no JSON control characters or quotes. */
        float hz=(mon.min_bin+candidates[i].freq_offset+candidates[i].freq_sub/2.0f)/mon.symbol_period;
        float dt=(candidates[i].time_offset+candidates[i].time_sub/2.0f)*mon.symbol_period;
        used+=snprintf(output+used,sizeof(output)-used,"%s{\"snr\":%.1f,\"hz\":%.2f,\"dt\":%.3f,\"crc\":%u,\"crcCalculated\":%u,\"message\":\"%s\"}",
            total>1?",":"",estimate_snr(&mon,&candidates[i],&message),hz,dt,status.crc_extracted,status.crc_calculated,text);
    }
    output[used++]=']'; output[used]=0;
    monitor_free(&mon); return total;
}
