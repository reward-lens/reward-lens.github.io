import type { InstrumentStage, LagoonTheme } from "../rebuild/instrument-data";

interface Frame { at: number; opticalStrength: number; opticalTravel?:number; anchors: Array<{id:string;normalized:[number,number]}>; phase?: string; }
interface Clip { url:string; aspect:number; duration:number; frames:Frame[]; stageTimes:Record<InstrumentStage,number>; }
interface Manifest { version:number; forms:Record<"desktop"|"mobile",Record<LagoonTheme,Clip>>; }
/** One controlled clip from the authored live room. It never represents interactive 3D. */
export class RoomClip {
  private manifest: Manifest | null = null;
  private layers = new Map<LagoonTheme, HTMLVideoElement>();
  private loading = new Map<LagoonTheme, Promise<HTMLVideoElement>>();
  private tick = 0;
  private wake = 0;
  private projectedAt = 0;
  private theme: LagoonTheme;
  private visible = false;
  private paused = false;
  private dead = false;
  private stage: InstrumentStage = "reward";
  private wide = matchMedia("(min-width: 769px)");
  private transitionTimer = 0;
  private transitioning = false;
  private form: "desktop" | "mobile";
  constructor(private container:HTMLElement, theme:LagoonTheme, private signal:AbortSignal, private report:(values:Record<string,unknown>)=>void, private ready:()=>void) {
    this.theme=theme;this.form=this.wide.matches?"desktop":"mobile";
    this.wide.addEventListener("change",this.resize,{signal});
    signal.addEventListener("abort",()=>this.dispose(),{once:true});
  }
  async start() {
    const response=await fetch("/lagoon/fallback.json",{signal:this.signal,cache:"force-cache"});
    if(!response.ok) throw new Error(`Room clip manifest returned ${response.status}`);
    this.manifest=await response.json() as Manifest;
    if(!this.manifest?.forms?.[this.form]?.[this.theme]?.frames?.length) throw new Error("Invalid room clip manifest");
    if(this.dead) return;
    await this.load(this.theme,0);this.ready();this.reconcile();
  }
  private clip(theme=this.theme) {return this.manifest!.forms[this.form][theme];}
  private async load(theme:LagoonTheme,time:number) {
    const pending=this.loading.get(theme);if(pending)return pending;
    const old=this.layers.get(theme);if(old&&old.readyState>=2) return old;
    const video=document.createElement("video");video.className="instrument__clip";video.muted=true;video.playsInline=true;video.loop=true;video.preload="auto";video.setAttribute("aria-hidden","true");
    video.dataset.theme=theme;video.src=this.clip(theme).url;
    this.layers.set(theme,video);this.container.append(video);
    const task=(async()=>{
      await new Promise<void>((resolve,reject)=>{
        const timer=window.setTimeout(()=>reject(new Error("Room clip decoding timed out")),10000);
        const done=()=>{clearTimeout(timer);resolve();};
        const fail=()=>{clearTimeout(timer);reject(new Error("Room clip failed to decode"));};
        video.addEventListener("loadeddata",done,{once:true,signal:this.signal});video.addEventListener("error",fail,{once:true,signal:this.signal});
        this.signal.addEventListener("abort",()=>{clearTimeout(timer);reject(this.signal.reason);},{once:true});
      });
      if(this.dead||this.layers.get(theme)!==video) return video;
      if(time>0) video.currentTime=Math.min(time,Math.max(0,video.duration-.01));
      video.classList.toggle("is-current",theme===this.theme);return video;
    })();
    this.loading.set(theme,task);
    try{return await task;}finally{if(this.loading.get(theme)===task)this.loading.delete(theme);}
  }
  setEligibility(visible:boolean,paused:boolean) {this.visible=visible;this.paused=paused;this.reconcile();}
  async setTheme(theme:LagoonTheme) {
    if(theme===this.theme||!this.manifest||this.dead) return;
    const time=this.layers.get(this.theme)?.currentTime??0;this.theme=theme;
    const next=await this.load(theme,time);if(this.dead||theme!==this.theme||this.layers.get(theme)!==next) return;
    next.currentTime=time;
    this.layers.forEach((video,key)=>video.classList.toggle("is-current",key===this.theme));
    this.transitioning=true;
    clearTimeout(this.transitionTimer);this.transitionTimer=window.setTimeout(()=>{this.transitioning=false;this.layers.forEach((video,key)=>{if(key!==this.theme)video.pause();});},800);
    this.reconcile();this.project();
  }
  select(stage:InstrumentStage) {
    this.stage=stage;if(!this.manifest||this.paused) return;
    const time=this.clip().stageTimes[stage];this.layers.forEach(video=>{video.currentTime=time;});this.reconcile();
  }
  private resize=()=>{
    const form=this.wide.matches?"desktop":"mobile";if(form===this.form||!this.manifest) return;
    const time=this.layers.get(this.theme)?.currentTime??0;
    this.form=form;this.layers.forEach(video=>{video.pause();video.removeAttribute("src");video.load();video.remove();});this.layers.clear();this.loading.clear();
    void this.load(this.theme,time).then(()=>{this.reconcile();this.project();}).catch(()=>this.report({fallbackFailure:"resize decode failed"}));
  };
  private project=()=>{
    const video=this.layers.get(this.theme);if(!video||!this.manifest||this.dead)return;
    const clip=this.clip();const time=video.currentTime;
    const frame=clip.frames.reduce((closest,value)=>Math.abs(value.at-time)<Math.abs(closest.at-time)?value:closest,clip.frames[0]);
    const box=this.container.getBoundingClientRect();const width=Math.min(box.width,box.height*clip.aspect),height=width/clip.aspect;
    const anchors=frame.anchors.map(point=>({id:point.id,normalized:[((box.width-width)/2+point.normalized[0]*width)/box.width,((box.height-height)/2+point.normalized[1]*height)/box.height] as [number,number]}));
    const metrics={anchors,opticalStrength:frame.opticalStrength,opticalTravel:frame.opticalTravel,phase:frame.phase,mode:"animated-fallback",clipTime:time,stage:this.stage,paused:this.paused};
    this.report(metrics);document.dispatchEvent(new CustomEvent("rewardlens:lab-projection",{detail:metrics}));
    return frame;
  };
  private reconcile() {
    cancelAnimationFrame(this.tick);clearTimeout(this.wake);this.tick=this.wake=0;this.projectedAt=0;
    if(this.dead||!this.manifest)return;
    const play=this.visible&&!this.paused;
    this.layers.forEach((video,key)=>{if(play&&(key===this.theme||this.transitioning))void video.play().catch(()=>this.report({autoplayBlocked:true,fallbackFailure:"Room clip autoplay was blocked"}));else video.pause();});
    if(play){
      const draw=(now:number)=>{
        this.tick=0;if(!this.visible||this.paused||this.dead)return;
        if(now-this.projectedAt<1000/18){this.tick=requestAnimationFrame(draw);return;}
        this.projectedAt=now;const frame=this.project();
        if(frame?.phase==="rest"){
          const video=this.layers.get(this.theme)!;const clip=this.clip();
          const firstActive=clip.frames.find(value=>value.phase!=="rest")?.at??.06;
          const next=clip.frames.find(value=>value.at>video.currentTime&&value.phase!=="rest")?.at??clip.duration+firstActive;
          this.wake=window.setTimeout(()=>{this.wake=0;this.tick=requestAnimationFrame(draw);},Math.max(16,(next-video.currentTime)*1000));
        }else this.tick=requestAnimationFrame(draw);
      };
      this.tick=requestAnimationFrame(draw);
    }else this.project();
  }
  dispose() {if(this.dead)return;this.dead=true;cancelAnimationFrame(this.tick);clearTimeout(this.wake);clearTimeout(this.transitionTimer);this.layers.forEach(video=>{video.pause();video.removeAttribute("src");video.load();video.remove();});this.layers.clear();this.loading.clear();}
}
