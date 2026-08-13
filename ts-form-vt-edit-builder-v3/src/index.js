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
  const r = await fetch(url,{headers:{accept:"application/json","user-agent":"TS-Form-VT-Edit-Builder/3.0"}});
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
    race:{event_id:race.event_id,meeting_id:race.meeting_id,meeting_name:race.meeting_name,display_meeting_name:race.display_meeting_name,description:race.description,race_number:race.race_number,race_date_nz:race.race_date_nz,distance:race.distance,track_condition:race.track_condition,class:race.class,country:race.country},
    results:res.map(x=>({entrant_id:x.entrant_id,runner_number:x.runner_number,name:x.name,position:x.position,barrier:x.barrier,margin_length:x.margin_length})),
    runners:(d.runners||[]).map(x=>({entrant_id:x.entrant_id,horse_id:x.horse_id,runner_number:x.runner_number,name:x.name,is_scratched:x.is_scratched,jockey:x.jockey,trainer_name:x.trainer_name,silk_url_64x64:x.silk_url_64x64,silk_url_128x128:x.silk_url_128x128,last_twenty_starts:x.last_twenty_starts,last_starts:x.last_starts,form_comment:x.form_comment,form_comment_short:x.form_comment_short,preview:x.preview,result:rmap.get(String(x.runner_number))||null}))
  };
}

export default {
  async fetch(request, env){
    const url=new URL(request.url);
    try{
      if(url.pathname==="/api/health") return jsonResponse({ok:true,service:"ts-form-vt-edit-builder",version:3});
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
        const country=(url.searchParams.get("country")||"NZ").toUpperCase();
        if(!date || (!horseId && !horseName)) return jsonResponse({error:"date and horse identifier are required"},400);

        const diagnostics={
          date, venue, horse_id:horseId, horse_name:horseName, start_id:startId,
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
        let lp;
        try{
          lp=await racesFor(date,country);
        }catch(err){
          return jsonResponse({
            error:"Historical race-list lookup failed",
            diagnostics,
            upstream_error:{
              message:err?.message||String(err),
              url:err?.upstream||null,
              body:err?.body||null
            }
          },502);
        }

        let raceList=lp?.data?.races || lp?.races || (Array.isArray(lp?.data)?lp.data:[]) || [];
        diagnostics.race_list_found=raceList.length;

        // Prefer race summaries whose meeting/venue metadata resembles the form venue when present.
        // RaceSummary is sparse, so we still scan every race on the date if needed.
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

        return jsonResponse({
          error:"Could not resolve this form start to a TAB historical race",
          diagnostics
        },404);
      }
      return env.ASSETS.fetch(request);
    }catch(err){ return jsonResponse({error:err?.message||String(err)},502); }
  }
};
