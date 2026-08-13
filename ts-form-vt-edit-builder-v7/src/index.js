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
  const r = await fetch(url,{headers:{accept:"application/json","user-agent":"TS-Form-VT-Edit-Builder/7.0"}});
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
async function meetingsFor(date,country="NZ"){
  const u=new URL(`${TAB_BASE}/meetings`);
  u.searchParams.set("category","T");
  if(country) u.searchParams.set("country",country);
  u.searchParams.set("date_from",date); u.searchParams.set("date_to",date);
  u.searchParams.set("enc","json"); u.searchParams.set("limit","200");
  return tabJSON(u.toString());
}
async function racesFor(date,country="NZ"){
  const u=new URL(`${TAB_BASE}/list`);
  if(country) u.searchParams.set("countries",country);
  u.searchParams.set("meet_types","T");
  u.searchParams.set("date_from",date);
  u.searchParams.set("date_to",date);
  u.searchParams.set("enc","json");
  u.searchParams.set("limit","200");
  return tabJSON(u.toString());
}
async function channelRacesFor(date){
  const channels=["Trackside1","Trackside2","Live1","Live2","NoVideos"];
  const byId=new Map();
  const errors=[];
  for(const channel of channels){
    const u=new URL(`${TAB_BASE}/races`);
    u.searchParams.set("channel",channel);
    u.searchParams.set("date",date);
    u.searchParams.set("type","T");
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
    runners:(d.runners||[]).map(x=>({entrant_id:x.entrant_id,horse_id:x.horse_id,runner_number:x.runner_number,name:x.name,is_scratched:x.is_scratched,jockey:x.jockey,trainer_name:x.trainer_name,silk_url_64x64:x.silk_url_64x64,silk_url_128x128:x.silk_url_128x128,last_twenty_starts:x.last_twenty_starts,last_starts:x.last_starts,form_comment:x.form_comment,form_comment_short:x.form_comment_short,preview:x.preview,result:rmap.get(String(x.runner_number))||null}))
  };
}

export default {
  async fetch(request, env){
    const url=new URL(request.url);
    try{
      if(url.pathname==="/api/health") return jsonResponse({ok:true,service:"ts-form-vt-edit-builder",version:7});
      if(url.pathname==="/api/meetings"){
        const date=cleanDate(url.searchParams.get("date")); if(!date) return jsonResponse({error:"date required YYYY-MM-DD"},400);
        const country=(url.searchParams.get("country")||"NZ").toUpperCase();
        return jsonResponse(await meetingsFor(date,country));
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
        const distance=String(url.searchParams.get("distance")||"").replace(/\D/g,"");
        const country=(url.searchParams.get("country")||"NZ").toUpperCase();
        if(!date || (!horseId && !horseName)) return jsonResponse({error:"date and horse identifier are required"},400);

        const diagnostics={
          date, venue, distance, horse_id:horseId, horse_name:horseName, start_id:startId,
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
          const lp=await racesFor(date,country);
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
          const cp=await channelRacesFor(date);
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
          const mp=await meetingsFor(date,country);
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
