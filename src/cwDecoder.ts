export type CwSettings = { tone: number; auto: boolean; wpm: number; autoTone?: boolean };
export type CwSnapshot = { text: string; wpm: number; acquired: boolean; confidence: number; tonePresent: boolean; toneHz: number; levelDb: number; samples: number; sampleRate: number; state: string };
const CODE: Record<string,string> = Object.fromEntries([
  ['A','.-'],['B','-...'],['C','-.-.'],['D','-..'],['E','.'],['F','..-.'],['G','--.'],['H','....'],['I','..'],['J','.---'],['K','-.-'],['L','.-..'],['M','--'],['N','-.'],['O','---'],['P','.--.'],['Q','--.-'],['R','.-.'],['S','...'],['T','-'],['U','..-'],['V','...-'],['W','.--'],['X','-..-'],['Y','-.--'],['Z','--..'],
  ['0','-----'],['1','.----'],['2','..---'],['3','...--'],['4','....-'],['5','.....'],['6','-....'],['7','--...'],['8','---..'],['9','----.'],['.','.-.-.-'],[',','--..--'],['?','..--..'],['/','-..-.'],['=','-...-'],['+','.-.-.'],['-','-....-'],['@','.--.-.'],['(','-.--.'],[')','-.--.-'],["'",'.----.'],[':', '---...'],[';', '-.-.-.'],['!', '-.-.--'],['"','.-..-.'],
].map(([letter,code])=>[code,letter]));
function settingsOk(s: CwSettings) { return Number.isFinite(s.tone) && s.tone>=300 && s.tone<=1000 && (s.autoTone===undefined||typeof s.autoTone==='boolean') && typeof s.auto==='boolean' && Number.isFinite(s.wpm) && s.wpm>=5 && s.wpm<=40; }
/** Read-only PCM consumer. No audio nodes, network, timers, transcript templates or language guesses. */
export class CwDecoder {
  private settings: CwSettings;
  private rate=0; private frames=0; private frameSize=60; private sampleCount=0;
  private oscillators: {c:number;s:number;cos:number;sin:number;i:number;q:number;ii:number;qq:number}[]=[];
  private alpha=0;
  private detectedTone=0; private level=0; private toneScore=0;
  private searchSamples:number[]=[]; private decimation=1; private decimationCount=0;
  private decimationSum=0; private candidateTone=0; private toneVotes=0;
  private tuneOscillators(tone:number) {
    this.oscillators=[tone,tone-160,tone+160].map(f=>({c:1,s:0,cos:Math.cos(2*Math.PI*f/this.rate),sin:Math.sin(2*Math.PI*f/this.rate),i:0,q:0,ii:0,qq:0}));
  }
  private searchTone() {
    const x=this.searchSamples,rate=this.rate/this.decimation,N=x.length;
    const windowed=x.map((v,i)=>v*(.5-.5*Math.cos(2*Math.PI*i/(N-1))));
    const powers:number[]=[];
    for(let f=300;f<=1000;f+=25){
      const coefficient=2*Math.cos(2*Math.PI*f/rate);let a=0,b=0;
      for(let i=0;i<N;i++){const v=windowed[i]+coefficient*a-b;b=a;a=v;}
      powers.push(Math.max(0,a*a+b*b-coefficient*a*b));
    }
    const max=Math.max(...powers),index=powers.indexOf(max),sum=powers.reduce((a,b)=>a+b,0);
    const sorted=[...powers].sort((a,b)=>a-b),median=sorted[sorted.length>>1];
    const narrow=max/Math.max(sum,1e-20),contrast=max/Math.max(median,1e-20);
    this.toneScore=narrow>.22&&contrast>12?Math.min(1,contrast/40):0;
    if(!this.toneScore)return;
    const l=Math.log(Math.max(powers[index-1]??max,1e-20)),c=Math.log(Math.max(max,1e-20)),r=Math.log(Math.max(powers[index+1]??max,1e-20));
    const offset=index>0&&index<powers.length-1?Math.max(-.5,Math.min(.5,.5*(l-r)/(l-2*c+r)||0)):0;
    const tone=300+(index+offset)*25;
    if(Math.abs(tone-this.candidateTone)<35)this.toneVotes++;else {this.candidateTone=tone;this.toneVotes=1;}
    if(this.toneVotes<3)return;
    // Key-up gaps must not pull a locked receiver toward another noise peak.
    if(this.detectedTone && Math.abs(tone-this.detectedTone)>45 &&
      (this.sampleCount/this.rate-this.lastSignal<1.5 || this.toneVotes<6))return;
    // Ignore modulation sidebands and retain lock through key-up gaps.
    if(!this.detectedTone||Math.abs(tone-this.detectedTone)>45){
      this.detectedTone=tone;this.tuneOscillators(tone);
      this.minimum=Infinity;this.minima=[];this.floor=this.peak=1e-10;
      this.on=this.candidate=false;this.candidateFrames=0;this.edge=this.sampleCount/this.rate;
      this.symbols='';this.letterDone=this.wordDone=true;this.quality=this.timing=0;
      this.marks=[];this.gaps=[];
    }
  }
  private marks:number[]=[]; private gaps:number[]=[]; private dot=.06;
  private minimum=Infinity; private minima:number[]=[]; private floor=1e-10; private peak=1e-10;
  private framePower=0; private frameGuard=0; private block=0;
  private on=false; private candidate=false; private candidateFrames=0; private edge=0;
  private symbols=''; private letterDone=true; private wordDone=true;
  private quality=0; private timing=0; private valid=0; private total=0;
  private lastSignal=0; private lastDecoded=-Infinity; private text='';
  constructor(settings: CwSettings, text='') {
    if(!settingsOk(settings)) throw new Error('Invalid CW settings');
    this.settings={...settings};this.text=text.slice(-12000);this.dot=1.2/settings.wpm;
  }
  configure(settings:CwSettings) {
    if(!settingsOk(settings)) return;
    this.settings={...settings};this.resetSignal();
  }
  resetSignal() {
    this.detectedTone=0;this.level=this.toneScore=0;this.searchSamples=[];
    this.decimationCount=this.decimationSum=this.toneVotes=this.candidateTone=0;
    this.rate=0;this.frames=this.sampleCount=this.block=0;this.oscillators=[];
    this.marks=[];this.gaps=[];this.dot=1.2/this.settings.wpm;
    this.minimum=Infinity;this.minima=[];this.floor=this.peak=1e-10;
    this.framePower=this.frameGuard=0;this.on=this.candidate=false;this.candidateFrames=0;this.edge=0;
    // A retune/rate change invalidates the unfinished symbol; never carry it to another station.
    this.lastDecoded=-Infinity;this.symbols='';this.letterDone=this.wordDone=true;this.quality=this.timing=this.valid=this.total=this.lastSignal=0;
    if(this.text && !this.text.endsWith('\n'))this.text+='\n';
  }
  private initialise(rate:number) {
    this.rate=rate;this.frameSize=Math.max(1,Math.round(rate*.005));
    this.alpha=1-Math.exp(-2*Math.PI*45/rate);
    this.decimation=Math.max(1,Math.floor(rate/3000));
    this.detectedTone=this.settings.autoTone?0:this.settings.tone;
    this.tuneOscillators(this.settings.tone);
  }
  push(samples:Float32Array,rate:number) {
    if(!Number.isFinite(rate)||rate<3000||rate>192000)return;
    if(this.rate!==rate){this.resetSignal();this.initialise(rate);}
    const a=this.alpha;
    for(let n=0;n<samples.length;n++){
      const x=Number.isFinite(samples[n])?samples[n]:0;
      if(this.settings.autoTone){
        this.decimationSum+=x;
        if(++this.decimationCount===this.decimation){
          this.searchSamples.push(this.decimationSum/this.decimation);this.decimationCount=this.decimationSum=0;
          if(this.searchSamples.length>=Math.round(this.rate/this.decimation*.04)){this.searchTone();this.searchSamples=[];}
        }
      }
      for(let k=0;k<3;k++){
        const b=this.oscillators[k];const c=b.c*b.cos-b.s*b.sin;b.s=b.s*b.cos+b.c*b.sin;b.c=c;
        b.i+=a*(x*b.c-b.i);b.q+=a*(x*b.s-b.q);
        b.ii+=a*(b.i-b.ii);b.qq+=a*(b.q-b.qq);
        const p=b.ii*b.ii+b.qq*b.qq;
        if(k===0)this.framePower+=p;else this.frameGuard+=p*.5;
      }
      this.sampleCount++;
      if(++this.block===this.frameSize){
        this.block=0;this.measure(this.framePower/this.frameSize,this.frameGuard/this.frameSize);
        this.framePower=this.frameGuard=0;
        // Bound oscillator round-off without per-sample trig or allocations.
        for(const b of this.oscillators){const norm=1/Math.hypot(b.c,b.s);b.c*=norm;b.s*=norm;}
      }
    }
  }
  private estimateSpeed() {
    if(!this.settings.auto||this.marks.length<6)return;
    const sorted=[...this.marks].sort((a,b)=>a-b),candidates:number[]=[];
    for(const q of [.1,.25,.5,.75,.9])for(const ratio of [1,3]){
      const d=sorted[Math.floor((sorted.length-1)*q)]/ratio;
      if(d>=.02&&d<=.26)candidates.push(Math.max(.03,Math.min(.24,d)));
    }
    let best=this.dot,bestCost=Infinity;
    for(const d of candidates){
      let cost=0,dits=0,dahs=0;
      for(const length of this.marks){const target=length<d*2?d:d*3;cost+=Math.min(1.5,Math.abs(length-target)/target);if(target===d)dits++;else dahs++;}
      cost/=this.marks.length;
      if(!dits||!dahs)cost+=.08;
      if(this.gaps.length){let gapCost=0;for(const length of this.gaps)gapCost+=Math.min(...[1,3,7].map(r=>Math.min(1,Math.abs(length-d*r)/(d*r))));cost+=.25*gapCost/this.gaps.length;}
      cost+=.01*Math.abs(d-this.dot)/this.dot;
      if(cost<bestCost){bestCost=cost;best=d;}
    }
    this.dot=this.marks.length<14?best:this.dot+.25*(best-this.dot);
  }
  private append(value:string) { this.text=(this.text+value).slice(-12000); }
  private erasure() {
    if(this.sampleCount/this.rate-this.lastDecoded<3 && this.text && !/[�\s]$/.test(this.text))this.append('�');
  }
  private letter() {
    if(this.letterDone||!this.symbols)return;
    const decoded=CODE[this.symbols];
    // Reject isolated noise bursts instead of turning every brief peak into E.
    // Confidence is diagnostic, never a language model or callsign correction.
    if(this.quality*this.timing>=.5 && (!this.settings.auto || this.marks.length>=6)) {
      this.append(decoded??'�');this.lastDecoded=this.sampleCount/this.rate;this.total++;if(decoded)this.valid++;
    }else this.erasure();
    this.symbols='';this.letterDone=true;
  }
  private transition(next:boolean,time:number) {
    const duration=time-this.edge;
    if(this.on){
      if(duration>=.024&&duration<=.9&&this.quality>=.5){
        // Envelope hysteresis extends marks by roughly two 5ms frames.
        const length=Math.max(.014,duration-.010);
        this.marks.push(length);if(this.marks.length>64)this.marks.shift();this.estimateSpeed();
        const dash=length>=this.dot*2,target=this.dot*(dash?3:1);
        const fit=Math.max(0,1-Math.abs(length-target)/target);
        this.timing=this.timing*.8+fit*.2;
        this.symbols+=dash?'-':'.';this.letterDone=this.wordDone=false;
        if(this.symbols.length>8){this.symbols='';this.erasure();this.letterDone=true;}
      }else{this.erasure();this.symbols='';this.letterDone=true;this.timing*=.5;}
    }else if(this.marks.length){
      if(duration>=.014&&duration<2){this.gaps.push(duration+.010);if(this.gaps.length>64)this.gaps.shift();}
      if(duration>=this.dot*2.35)this.letter();
      if(duration>=this.dot*5.7&&!this.wordDone){if(this.text&&!/\s$/.test(this.text))this.append(' ');this.wordDone=true;}
    }
    this.on=next;this.edge=time;
  }
  private measure(power:number,guard:number) {
    const t=this.sampleCount/this.rate;this.frames++;
    this.minimum=Math.min(this.minimum,power);
    if(this.frames%50===0){this.minima.push(this.minimum);if(this.minima.length>8)this.minima.shift();this.minimum=Infinity;
      const noise=Math.max(1e-12,Math.min(...this.minima)*1.5);this.floor+=.2*(noise-this.floor);
    }
    this.peak=Math.max(power,this.peak*.992);
    const noise=Math.max(this.floor,guard*1.6,1e-12);
    const threshold=Math.max(noise*(this.on?1.6:2.5),noise+(this.peak-noise)*(this.on?.10:.18));
    this.level=power;
    const present=power>threshold && (!this.settings.autoTone || this.detectedTone>0);
    if(present!==this.candidate){this.candidate=present;this.candidateFrames=1;}else this.candidateFrames++;
    if(this.candidate!==this.on&&this.candidateFrames>=2)this.transition(this.candidate,t-this.frameSize/this.rate);
    const contrast=Math.max(0,Math.min(1,Math.log10(Math.max(1,power/noise))/.9));
    if(this.on){this.lastSignal=t;this.quality+=.1*(contrast-this.quality);}
    if(!this.on){
      const gap=t-this.edge;
      if(gap>=this.dot*2.35)this.letter();
      if(gap>=this.dot*5.7&&!this.wordDone){if(this.text&&!/\s$/.test(this.text))this.append(' ');this.wordDone=true;}
      if(t-this.lastSignal>Math.max(1,this.dot*7))this.quality*=.97;
    }
    if(this.on&&t-this.edge>1.2){this.quality=0;this.symbols='';this.letterDone=true;}
  }
  snapshot():CwSnapshot {
    const valid=this.total?this.valid/this.total:1;
    return {text:this.text,wpm:Math.round(1.2/this.dot),acquired:!this.settings.auto||this.marks.length>=6,
      confidence:Math.round(100*this.quality*(.3+.7*this.timing)*valid),tonePresent:this.on,
      toneHz:Math.round(this.detectedTone),levelDb:10*Math.log10(Math.max(1e-12,this.level*4)),samples:this.sampleCount,sampleRate:this.rate,
      state:!this.sampleCount?'Ожидание PCM':this.settings.autoTone&&!this.detectedTone?'Поиск тона':this.on?'Сигнал':this.marks.length?'Пауза':'Ожидание посылок' };
  }
}
