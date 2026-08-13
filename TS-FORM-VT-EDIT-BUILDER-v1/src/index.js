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
  const r = await fetch(url,{headers:{accept:"application/json","user-agent":"TS-Form-VT-Edit-Builder/1.0"}});
  const text = await r.text();
  let data; try{data=JSON.parse(text)}catch{data={raw:text}}
  if(!r.ok) throw new Error(`TAB ${r.status}: ${data?.error||data?.message||"request failed"}`);
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
async function eventById(id){ return tabJSON(`${TAB_BASE}/events/${encodeURIComponent(id)}?enc=json`); }
function hasHorse(data, horseId){
  const list=data?.data?.runners||data?.runners||[];
  return list.some(r=>String(r.horse_id||"")===String(horseId||""));
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
      if(url.pathname==="/api/health") return jsonResponse({ok:true,service:"ts-form-vt-edit-builder",version:1});
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
        const startId=String(url.searchParams.get("start_id")||"");
        const venue=String(url.searchParams.get("venue")||"");
        const country=(url.searchParams.get("country")||"NZ").toUpperCase();
        if(!date || !horseId) return jsonResponse({error:"date and horse_id are required"},400);

        // Fast path: some feeds may expose the historical event UUID directly in last_starts[].id.
        if(cleanUUID(startId)){
          try{
            const p=await eventById(startId);
            if(hasHorse(p,horseId)) return jsonResponse({method:"start_id",event:compactEvent(p)});
          }catch{}
        }

        // Safe fallback: search all T races on the historical date and locate this stable horse_id.
        const mp=await meetingsFor(date,country);
        let meetings=mp?.data?.meetings||[];
        if(venue){
          const nv=norm(venue);
          const preferred=meetings.filter(m=>norm(m.name).includes(nv)||nv.includes(norm(m.name)));
          if(preferred.length) meetings=[...preferred,...meetings.filter(m=>!preferred.includes(m))];
        }
        for(const mtg of meetings){
          const races=mtg.races||[];
          for(const race of races){
            const id=cleanUUID(race.id||race.event_id); if(!id) continue;
            try{
              const p=await eventById(id);
              if(hasHorse(p,horseId)) return jsonResponse({method:"date_venue_horse",event:compactEvent(p)});
            }catch{}
          }
        }
        return jsonResponse({error:"Could not resolve this form start to a TAB historical race",date,venue,horse_id:horseId},404);
      }
      return env.ASSETS.fetch(request);
    }catch(err){ return jsonResponse({error:err?.message||String(err)},502); }
  }
};
