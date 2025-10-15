export default async function handler(req) {
  if (req.method !== "GET") return new Response("Method Not Allowed", { status: 405 });
  const cors={"access-control-allow-origin":"*","access-control-allow-methods":"GET, OPTIONS","access-control-allow-headers":"content-type"};
  if (req.method==="OPTIONS") return new Response(null,{headers:cors});
  try{
    const url=new URL(req.url); const id=url.pathname.split("/").pop();
    const base=`https://api.runpod.ai/v2/${process.env.RP_ENDPOINT}`;
    const st=await fetch(`${base}/status/${id}`,{headers:{Authorization:`Bearer ${process.env.RP_API_KEY}`}});
    if(!st.ok) return Response.json({error:"RunPod status error",details:await st.text()},{status:st.status,headers:cors});
    const status=await st.json();
    const imageB64=status?.output?.image_b64||status?.output?.imageBase64||null;
    const imageUrl=status?.output?.imageUrl||null;
    return Response.json({
      status:status.status,
      delayTime:status.delayTime,
      executionTime:status.executionTime,
      output:{imageB64,imageUrl,...status.output}
    },{headers:cors});
  }catch(e){return Response.json({error:e?.message||"Server error"},{status:500,headers:cors});}
}
export const config={runtime:"edge"};