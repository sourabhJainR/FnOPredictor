import { scoreNewsItem } from "./research.js";

const decode=s=>String(s||"").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1").replace(/<[^>]*>/g," ").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/\s+/g," ").trim();
const tag=(xml,name)=>xml.match(new RegExp(`<(?:\\w+:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${name}>`,"i"))?.[1]||"";
function parseFeed(xml,source){
  const blocks=[...xml.matchAll(/<(item|entry)\b[^>]*>[\s\S]*?<\/\1>/gi)].map(m=>m[0]);
  return blocks.slice(0,30).map(block=>{
    const linkTag=block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*\/?\s*>/i);
    const rawLink=tag(block,"link");
    const item={title:decode(tag(block,"title")),summary:decode(tag(block,"description")||tag(block,"summary")||tag(block,"content")),link:(linkTag?.[1]||decode(rawLink)).trim(),published:decode(tag(block,"pubDate")||tag(block,"published")||tag(block,"updated")),source};
    if(!item.title)return null;
    return scoreNewsItem(item);
  }).filter(Boolean);
}

export async function fetchNewsFeeds(feedUrls,fetchImpl=fetch){
  const results=[];
  for(const raw of feedUrls){
    let url;
    try{url=new URL(raw);if(url.protocol!=="https:")continue;}catch{continue;}
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
    try{
      const response=await fetchImpl(url,{headers:{accept:"application/rss+xml, application/atom+xml, application/xml, text/xml"},signal:controller.signal});
      if(!response.ok)continue;
      const xml=await response.text();
      results.push(...parseFeed(xml,url.hostname));
    }catch{}finally{clearTimeout(timer);}
  }
  const seen=new Set();
  return results.filter(item=>{const key=item.link||item.title.toLowerCase();if(seen.has(key))return false;seen.add(key);return true;}).slice(0,100);
}
