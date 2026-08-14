const TAB_BASE = "https://api.tab.co.nz/affiliates/v1/racing";

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
function cleanDate(v){ return /^\d{4}-\d{2}-\d{2}$/.test(v||"") ? v : null; }
function cleanUUID(v){ return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v||"") ? v : null; }
function norm(s){ return String(s||"").toLowerCase().replace(/[^a-z0-9]/g,""); }

async function tabJSON(url){
  const r = await fetch(url,{headers:{accept:"application/json","user-agent":"TS-Form-VT-Edit-Builder/20.0"}});
  const text = await r.text();
  let data; try{data=JSON.parse(text)}catch{data={raw:text}}
  if(!r.ok){
    const detail=data?.error||data?.message||data?.raw||"request failed";
    const err=new Error(`TAB ${r.status}: ${typeof detail==="string"?detail:"request failed"}`);
    err.status=r.status; err.upstream=url; err.body=data;
    throw err;
  }
  return data;
}
async function meetingsFor(date,country="NZ",category="T"){
  const u=new URL(`${TAB_BASE}/meetings`);
  u.searchParams.set("category",category==="H"?"H":"T");
  if(country) u.searchParams.set("country",country);
  u.searchParams.set("date_from",date); u.searchParams.set("date_to",date);
  u.searchParams.set("enc","json"); u.searchParams.set("limit","200");
  return tabJSON(u.toString());
}
async function racesFor(date,country="NZ",category="T"){
  const u=new URL(`${TAB_BASE}/list`);
  if(country) u.searchParams.set("countries",country);
  u.searchParams.set("meet_types",category==="H"?"H":"T");
  u.searchParams.set("date_from",date);
  u.searchParams.set("date_to",date);
  u.searchParams.set("enc","json");
  u.searchParams.set("limit","200");
  return tabJSON(u.toString());
}
async function channelRacesFor(date,category="T"){
  const channels=["Trackside1","Trackside2","Live1","Live2","NoVideos"];
  const byId=new Map();
  const errors=[];
  for(const channel of channels){
    const u=new URL(`${TAB_BASE}/races`);
    u.searchParams.set("channel",channel);
    u.searchParams.set("date",date);
    u.searchParams.set("type",category==="H"?"H":"T");
    u.searchParams.set("enc","json");
    try{
      const p=await tabJSON(u.toString());
      const races=p?.data?.races || p?.races || [];
      for(const r of races){
        const id=r.event_id||r.id;
        if(id && !byId.has(String(id))) byId.set(String(id),r);
      }
    }catch(err){
      errors.push({channel,message:err?.message||String(err),url:err?.upstream||u.toString()});
    }
  }
  return {races:[...byId.values()],errors};
}

function lrStrip(s){
  return String(s||"")
    .replace(/<script[\s\S]*?<\/script>/gi," ")
    .replace(/<style[\s\S]*?<\/style>/gi," ")
    .replace(/<[^>]+>/g," ")
    .replace(/&nbsp;|&#160;/gi," ")
    .replace(/&amp;/gi,"&")
    .replace(/&#39;|&apos;/gi,"'")
    .replace(/&quot;/gi,'"')
    .replace(/\s+/g," ").trim();
}
function lrNorm(s){
  return lrStrip(s).toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-z0-9]+/g," ").trim();
}
function lrEstimateMeetingId(date){
  // Public anchors: 7 Mar 2026 = 54916; 12 Aug 2026 = 55913.
  const a=new Date("2026-03-07T00:00:00Z");
  const d=new Date(`${date}T00:00:00Z`);
  const days=Math.round((d-a)/86400000);
  return Math.round(54916 + days*(997/158));
}
function lrPageMatchesDate(html,date){
  const t=lrNorm(html);
  const [y,m,d]=date.split("-").map(Number);
  const months=["","january","february","march","april","may","june","july","august","september","october","november","december"];
  const full=`${d} ${months[m]} ${y}`;
  const short=`${d} ${months[m].slice(0,3)} ${y}`;
  return t.includes(full)||t.includes(short);
}
function lrVenueFromHtml(html){
  const patterns=[
    /@\s*([^<\r\n]+?)\s+Last updated/i,
    /Race Meeting for [^<]+? at ([^<]+?) on \d{1,2}\s+[A-Z]{3}\s+\d{4}/i,
    /Courses?[^<]{0,100}@\s*([^<\r\n]+)/i
  ];
  for(const rx of patterns){
    const m=html.match(rx);
    if(m && m[1]) return lrStrip(m[1]).trim();
  }
  const text=lrStrip(html);
  const m=text.match(/@\s*([A-Za-zĀ-ž' -]{3,60})\s+Last updated/i);
  return m?.[1]?.trim()||"";
}
function lrRaceNumberFromHtml(html,distance,horseName){
  const dist=String(distance||"").replace(/\D/g,"");
  const horse=lrNorm(horseName);
  const links=[];
  const rx=/href=["']([^"']*\/RaceInfo\/(\d+)\/(\d+)\/Race-Detail\.aspx[^"']*)["']/gi;
  let m;
  while((m=rx.exec(html))){
    const ctx=lrStrip(html.slice(Math.max(0,m.index-1700),Math.min(html.length,m.index+2400)));
    const nctx=lrNorm(ctx);
    let score=0;
    if(dist && new RegExp(`\\b${dist}\\s*m\\b`,"i").test(ctx)) score+=4;
    if(horse && nctx.includes(horse)) score+=8;
    links.push({race_number:Number(m[3]),score});
  }
  links.sort((a,b)=>b.score-a.score);
  if(links.length && links[0].score>=4) return links[0].race_number;

  if(dist){
    const text=lrStrip(html);
    const found=[];
    const rxs=[
      new RegExp(`(?:race\\s*)?(\\d{1,2})[^\\n]{0,220}?\\b${dist}\\s*m\\b`,"ig"),
      new RegExp(`\\b(\\d{1,2})\\b[^\\n]{0,220}?\\b${dist}\\s*m\\b`,"ig")
    ];
    for(const r of rxs){
      let z;
      while((z=r.exec(text))){
        const n=Number(z[1]);
        if(n>=1 && n<=20) found.push(n);
      }
      const u=[...new Set(found)];
      if(u.length===1) return u[0];
    }
  }
  return null;
}

function lrRaceNumberFromOverview(html,meetingId,horseName){
  const horse=lrNorm(horseName);
  if(!horse) return null;

  // Completed meeting overviews contain final Race-Detail links followed by
  // the complete result block for that race.
  const rx=new RegExp(`(?:/)?RaceInfo/${meetingId}/(\\d{1,2})/Race-Detail\\.aspx`,"ig");
  const links=[];
  let m;
  while((m=rx.exec(html))){
    const n=Number(m[1]);
    if(n>=1 && n<=30) links.push({race_number:n,index:m.index});
  }

  // Collapse repeats of the same race link.
  const ordered=[];
  for(const x of links.sort((a,b)=>a.index-b.index)){
    if(!ordered.length || ordered[ordered.length-1].race_number!==x.race_number){
      ordered.push(x);
    }
  }

  for(let i=0;i<ordered.length;i++){
    const cur=ordered[i];
    const end=i+1<ordered.length ? ordered[i+1].index : html.length;
    const section=html.slice(cur.index,end);
    if(lrNorm(section).includes(horse)){
      return {race_number:cur.race_number,source:"overview_race_section"};
    }
  }
  return null;
}

async function loveRacingResolve(date,venue,distance,horseName){
  const estimate=lrEstimateMeetingId(date);
  const offsets=[0,1,-1,2,-2,3,-3,5,-5,8,-8,12,-12,16,-16,20,-20,25,-25,30,-30];
  const candidates=[];

  for(const off of offsets){
    const id=estimate+off;
    if(id<1) continue;
    const url=`https://loveracing.nz/RaceInfo/${id}/Meeting-Overview.aspx`;
    try{
      const r=await fetch(url,{
        headers:{accept:"text/html","user-agent":"TS-Form-VT-Edit-Builder/20.0"},
        redirect:"follow"
      });
      if(!r.ok) continue;
      const html=await r.text();
      if(!lrPageMatchesDate(html,date)) continue;

      const humanVenue=lrVenueFromHtml(html) || venue;
      const parsed=lrRaceNumberFromOverview(html,id,horseName);

      let score=1;
      const incoming=lrNorm(venue), actual=lrNorm(humanVenue);
      if(incoming && actual && (actual.includes(incoming)||incoming.includes(actual))) score+=4;
      if(parsed?.race_number) score+=10;

      candidates.push({
        ok:true,
        meeting_id:id,
        venue:humanVenue,
        race_number:parsed?.race_number||null,
        url,
        source:parsed?.source||"meeting_only",
        score
      });
    }catch{}
  }

  candidates.sort((a,b)=>b.score-a.score);
  if(candidates.length) return candidates[0];
  return {ok:false,estimate};
}


function rasVenueSlug(v){
  return String(v||"")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-z0-9]+/g,"-")
    .replace(/^-+|-+$/g,"");
}
async function racingAndSportsResolve(date,venue,horseName,distance){
  const horse=lrNorm(horseName);
  const slug=rasVenueSlug(venue);
  const dist=String(distance||"").replace(/\D/g,"");
  if(!slug || !horse) return {ok:false,reason:"missing venue/horse"};

  // The URL itself fixes venue + exact date + race number.
  // We accept a race number only if the selected horse is actually present on that page.
  for(let raceNo=1; raceNo<=20; raceNo++){
    const url=`https://www.racingandsports.com.au/horse-racing-results/new-zealand/${slug}/${date}/r${raceNo}`;
    try{
      const r=await fetch(url,{
        headers:{
          accept:"text/html",
          "user-agent":"Mozilla/5.0 (compatible; TS-Form-VT-Edit-Builder/20.0)"
        },
        redirect:"follow"
      });
      if(!r.ok) continue;

      const html=await r.text();
      const text=lrNorm(html);

      // Horse + exact venue/date URL is the deciding check.
      if(!text.includes(horse)) continue;

      // Distance is diagnostic/supporting only because historical feeds can disagree.
      let distanceMatch=null;
      if(dist){
        const plain=lrStrip(html);
        distanceMatch=new RegExp(`\\b${dist}\\s*m\\b`,"i").test(plain);
      }

      return {
        ok:true,
        race_number:raceNo,
        venue,
        url,
        source:"racing_and_sports_verified_horse_date_venue",
        confidence:"high",
        distanceMatch
      };
    }catch{}
  }

  return {
    ok:false,
    venue,
    source:"racing_and_sports_no_verified_horse_match"
  };
}


function ddmmyyWorker(date){
  const m=String(date||"").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}${m[2]}${m[1].slice(2)}` : "";
}
async function breednetResolve(date,trackCode,horseName,distance,humanVenue){
  const horse=lrNorm(horseName);
  const venue=String(humanVenue||"").trim();
  const slug=rasVenueSlug(venue);
  if(!slug || !horse) return {ok:false,reason:"missing human venue/horse"};

  const urls=[
    `https://www.breednet.com.au/race-results/new-zealand/${slug}/${date}`,
    `https://www.breednet.com.au/race-results/${slug}/${date}`
  ];

  for(const url of urls){
    try{
      const r=await fetch(url,{
        headers:{
          accept:"text/html",
          "user-agent":"Mozilla/5.0 (compatible; TS-Form-VT-Edit-Builder/20.0)"
        },
        redirect:"follow"
      });
      if(!r.ok) continue;

      const html=await r.text();
      const plain=lrStrip(html);
      const nplain=lrNorm(plain);
      if(!nplain.includes(horse)) continue;

      // Split the full meeting page by explicit final result headings: "Race N - ..."
      const matches=[...plain.matchAll(/\bRace\s+(\d{1,2})\s*-/gi)];
      for(let i=0;i<matches.length;i++){
        const raceNo=Number(matches[i][1]);
        if(raceNo<1 || raceNo>30) continue;
        const start=matches[i].index;
        const end=i+1<matches.length ? matches[i+1].index : plain.length;
        const section=plain.slice(start,end);
        if(lrNorm(section).includes(horse)){
          return {
            ok:true,
            race_number:raceNo,
            venue,
            url,
            source:"breednet_full_meeting_result_section",
            confidence:"high"
          };
        }
      }

      // Fallback: horse exists on page but parser couldn't assign its section.
      return {
        ok:false,
        venue,
        url,
        source:"breednet_horse_found_section_unresolved"
      };
    }catch(err){}
  }
  return {ok:false,venue,source:"breednet_meeting_not_found_or_horse_absent"};
}

async function eventById(id){ return tabJSON(`${TAB_BASE}/events/${encodeURIComponent(id)}?enc=json`); }
function getRunners(data){
  return data?.data?.runners || data?.runners || [];
}
function findHorse(data, horseId, horseName){
  const runners=getRunners(data);
  const hid=String(horseId||"");
  const hname=norm(horseName||"");
  let match=null;
  if(hid) match=runners.find(r=>String(r.horse_id||"")===hid) || null;
  if(!match && hname) match=runners.find(r=>norm(r.name)===hname) || null;
  return match;
}
function compactEvent(payload){
  const d=payload?.data||payload||{}; const race=d.race||{};
  const res=d.results||[]; const rmap=new Map(res.map(x=>[String(x.runner_number),x]));
  return {
    race:{event_id:race.event_id,meeting_id:race.meeting_id,meeting_name:race.meeting_name,display_meeting_name:race.display_meeting_name,venue_name:race.venue_name,track:race.track,description:race.description,race_number:race.race_number,race_date_nz:race.race_date_nz,distance:race.distance,track_condition:race.track_condition,class:race.class,country:race.country},
    results:res.map(x=>({entrant_id:x.entrant_id,runner_number:x.runner_number,name:x.name,position:x.position,barrier:x.barrier,margin_length:x.margin_length})),
    runners:(d.runners||[]).map(x=>({entrant_id:x.entrant_id,horse_id:x.horse_id,runner_number:x.runner_number,name:x.name,is_scratched:x.is_scratched,jockey:x.jockey,driver:x.driver,driver_name:x.driver_name,trainer:x.trainer,trainer_name:x.trainer_name,silk_url_64x64:x.silk_url_64x64,silk_url_128x128:x.silk_url_128x128,last_twenty_starts:x.last_twenty_starts,last_starts:x.last_starts,form_comment:x.form_comment,form_comment_short:x.form_comment_short,preview:x.preview,result:rmap.get(String(x.runner_number))||null}))
  };
}

export default {
  async fetch(request, env){
    const url=new URL(request.url);
    try{
      if(url.pathname==="/api/health") return jsonResponse({ok:true,service:"ts-form-vt-edit-builder",version:20});
      if(url.pathname==="/api/meetings"){
        const date=cleanDate(url.searchParams.get("date")); if(!date) return jsonResponse({error:"date required YYYY-MM-DD"},400);
        const country=(url.searchParams.get("country")||"NZ").toUpperCase();
        const category=(url.searchParams.get("category")||"T").toUpperCase()==="H"?"H":"T";
        return jsonResponse(await meetingsFor(date,country,category));
      }
      if(url.pathname.startsWith("/api/event/")){
        const id=cleanUUID(url.pathname.slice(11)); if(!id) return jsonResponse({error:"invalid event id"},400);
        return jsonResponse(compactEvent(await eventById(id)));
      }
      if(url.pathname==="/api/resolve-form-race"){
        const date=cleanDate(url.searchParams.get("date"));
        const horseId=String(url.searchParams.get("horse_id")||"");
        const horseName=String(url.searchParams.get("horse_name")||"");
        const startId=String(url.searchParams.get("start_id")||"");
        const venue=String(url.searchParams.get("venue")||"");
        const trackCode=String(url.searchParams.get("track_code")||"");
        const distance=String(url.searchParams.get("distance")||"").replace(/\D/g,"");
        const country=(url.searchParams.get("country")||"NZ").toUpperCase();
        const category=(url.searchParams.get("category")||"T").toUpperCase()==="H"?"H":"T";
        if(!date || (!horseId && !horseName)) return jsonResponse({error:"date and horse identifier are required"},400);

        const diagnostics={
          date, venue, track_code:trackCode, distance, category, horse_id:horseId, horse_name:horseName, start_id:startId,
          direct_id_attempted:false, meetings_found:0, races_checked:0, event_fetch_failures:0,
          matched_by:null
        };

        // Fast path: last_starts[].id may itself be an event UUID.
        if(cleanUUID(startId)){
          diagnostics.direct_id_attempted=true;
          try{
            const p=await eventById(startId);
            const matched=findHorse(p,horseId,horseName);
            if(matched){
              diagnostics.matched_by=String(matched.horse_id||"")===horseId && horseId ? "horse_id" : "horse_name";
              return jsonResponse({method:"start_id",diagnostics,event:compactEvent(p)});
            }
          }catch(err){
            diagnostics.direct_id_error=err?.message||String(err);
          }
        }

        // Historical fallback: use /racing/list, which returns individual race IDs + race numbers.
        // This is more direct than querying meetings for old dates.
        let raceList=[];
        try{
          const lp=await racesFor(date,country,category);
          raceList=lp?.data?.races || lp?.races || (Array.isArray(lp?.data)?lp.data:[]) || [];
          diagnostics.race_list_found=raceList.length;
        }catch(err){
          diagnostics.race_list_error=err?.message||String(err);
          diagnostics.race_list_url=err?.upstream||null;
        }

        // First scan individual historical race summaries if TAB supplies them.
        for(const race of raceList){
          const id=cleanUUID(race.id||race.event_id||race.eventId);
          if(!id) continue;
          diagnostics.races_checked++;
          try{
            const p=await eventById(id);
            const matched=findHorse(p,horseId,horseName);
            if(matched){
              diagnostics.matched_by=String(matched.horse_id||"")===horseId && horseId ? "horse_id" : "horse_name";
              return jsonResponse({method:"date_race_list_horse",diagnostics,event:compactEvent(p)});
            }
          }catch{
            diagnostics.event_fetch_failures++;
          }
        }

        // Another API route exposes races by broadcast channel and explicitly returns
        // event_id + meeting_name + race_number. This can work when /racing/list rejects an older date.
        try{
          const cp=await channelRacesFor(date,category);
          diagnostics.channel_races_found=cp.races.length;
          diagnostics.channel_errors=cp.errors;
          for(const race of cp.races){
            const id=cleanUUID(race.event_id||race.id);
            if(!id) continue;
            diagnostics.races_checked++;
            try{
              const p=await eventById(id);
              const matched=findHorse(p,horseId,horseName);
              if(matched){
                diagnostics.matched_by=String(matched.horse_id||"")===horseId && horseId ? "horse_id" : "horse_name";
                return jsonResponse({method:"date_channel_races_horse",diagnostics,event:compactEvent(p)});
              }
            }catch{
              diagnostics.event_fetch_failures++;
            }
          }
        }catch(err){
          diagnostics.channel_lookup_error=err?.message||String(err);
        }

        // Some older dates are rejected by /racing/list. Try the meetings endpoint as another
        // independent route before falling back to the form data already present in the browser.
        try{
          const mp=await meetingsFor(date,country,category);
          let meetings=mp?.data?.meetings || mp?.meetings || (Array.isArray(mp?.data)?mp.data:[]) || [];
          diagnostics.meetings_found=meetings.length;

          if(venue){
            const nv=norm(venue);
            const preferred=meetings.filter(m=>{
              const names=[m.name,m.meeting_name,m.display_meeting_name,m.venue_name].filter(Boolean).map(norm);
              return names.some(n=>n && (n.includes(nv)||nv.includes(n)));
            });
            if(preferred.length){
              const prefSet=new Set(preferred);
              meetings=[...preferred,...meetings.filter(m=>!prefSet.has(m))];
            }
          }

          const possibleRaceSummaries=[];
          for(const mtg of meetings){
            const races=mtg.races || mtg.events || [];
            const mtgNames=[mtg.name,mtg.meeting_name,mtg.display_meeting_name,mtg.venue_name,mtg.jetbet_track_name].filter(Boolean);
            const venueMatches=!venue || mtgNames.some(n=>{
              const a=norm(n), b=norm(venue);
              return a && b && (a.includes(b)||b.includes(a));
            });
            for(const race of races){
              const raceDistance=String(race.distance||"").replace(/\D/g,"");
              if(venueMatches && (!distance || !raceDistance || raceDistance===distance)){
                possibleRaceSummaries.push({meeting:mtg,race});
              }

              const id=cleanUUID(race.id||race.event_id||race.eventId);
              if(!id) continue;
              diagnostics.races_checked++;
              try{
                const p=await eventById(id);
                const matched=findHorse(p,horseId,horseName);
                if(matched){
                  diagnostics.matched_by=String(matched.horse_id||"")===horseId && horseId ? "horse_id" : "horse_name";
                  return jsonResponse({method:"date_meeting_horse",diagnostics,event:compactEvent(p)});
                }
              }catch{
                diagnostics.event_fetch_failures++;
              }
            }
          }

          // If TAB will give us the historical meeting but not a usable historical event,
          // a single race at the matching venue + distance is enough to recover the race number.
          if(possibleRaceSummaries.length===1){
            const {meeting,race}=possibleRaceSummaries[0];
            diagnostics.inferred_race_number=true;
            return jsonResponse({
              method:"meeting_venue_distance_inference",
              fallback:true,
              inferred:true,
              diagnostics,
              event:{
                race:{
                  event_id:race.id||race.event_id||"",
                  meeting_id:meeting.id||meeting.meeting_id||"",
                  meeting_name:meeting.name||meeting.meeting_name||venue,
                  display_meeting_name:meeting.name||meeting.display_meeting_name||venue,
                  venue_name:venue,
                  description:race.name||race.description||"",
                  race_number:race.race_number||race.number||"",
                  race_date_nz:date,
                  distance:race.distance||distance,
                  track_condition:race.track_condition||meeting.track_condition||"",
                  class:"",country
                },
                results:[],runners:[]
              }
            });
          }
          diagnostics.possible_race_summaries=possibleRaceSummaries.length;
        }catch(err){
          diagnostics.meetings_error=err?.message||String(err);
          diagnostics.meetings_url=err?.upstream||null;
        }

        // Last external NZ fallback: LOVERACING. Only recover historical venue/race number;
        // TAB remains the source of runner/form data.
        // Breednet historical lookup: TAB's raw track code is useful as a lookup key.
        if(country==="NZ" && category==="T" && trackCode){
          try{
            const br=await breednetResolve(date,trackCode,horseName,distance,venue);
            diagnostics.breednet=br;
            if(br.ok && br.race_number){
              return jsonResponse({
                method:"breednet_race_number",
                fallback:true,
                inferred:true,
                diagnostics,
                event:{
                  race:{
                    event_id:"",meeting_id:"",
                    meeting_name:venue,display_meeting_name:venue,venue_name:venue,track:venue,
                    description:"",race_number:br.race_number,race_date_nz:date,
                    distance:Number(distance)||"",track_condition:"",class:"",country
                  },
                  results:[],runners:[]
                }
              });
            }
          }catch(err){ diagnostics.breednet_error=err?.message||String(err); }
        }

        if(country==="NZ" && category==="T"){
          try{
            const lr=await loveRacingResolve(date,venue,distance,horseName);
            diagnostics.loveracing=lr;
            if(lr.ok && lr.race_number){
              return jsonResponse({
                method:"loveracing_race_number",
                fallback:true,
                inferred:true,
                diagnostics,
                event:{
                  race:{
                    event_id:"",
                    meeting_id:String(lr.meeting_id||""),
                    meeting_name:lr.venue||venue,
                    display_meeting_name:lr.venue||venue,
                    venue_name:lr.venue||venue,
                    track:lr.venue||venue,
                    description:"",
                    race_number:lr.race_number,
                    race_date_nz:date,
                    distance:Number(distance)||"",
                    track_condition:"",
                    class:"",
                    country
                  },
                  results:[],runners:[]
                }
              });
            }
          }catch(err){
            diagnostics.loveracing_error=err?.message||String(err);
          }
        }

        // LOVERACING overview is now the sole external race-number fallback.

        // A 200 fallback response lets the browser construct a useful provisional race from the
        // selected form start + the other upcoming runners' own form histories.
        return jsonResponse({
          method:"form_history_fallback",
          fallback:true,
          diagnostics,
          message:"TAB did not expose a resolvable historical event for this date. Use local form-history cross-match."
        });
      }
      return env.ASSETS.fetch(request);
    }catch(err){ return jsonResponse({error:err?.message||String(err)},502); }
  }
};
