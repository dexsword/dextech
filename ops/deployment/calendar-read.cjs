'use strict';
const {google}=require(process.argv[2]+'/node_modules/googleapis');
async function main(){
 const auth=new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID,process.env.GOOGLE_CLIENT_SECRET);
 auth.setCredentials({refresh_token:process.env.GOOGLE_REFRESH_TOKEN});
 const c=google.calendar({version:'v3',auth});const start=new Date();const end=new Date(start.getTime()+86400000);
 const a=await c.freebusy.query({requestBody:{timeMin:start.toISOString(),timeMax:end.toISOString(),items:[{id:'primary'}]}},{timeout:20000,retry:false});
 if(a.status!==200||!a.data.calendars||Object.keys(a.data.calendars).length!==1||Object.values(a.data.calendars).some(v=>v.errors?.length||!Array.isArray(v.busy)))throw new Error('FreeBusy failed');
 const b=await c.events.list({calendarId:'primary',timeMin:start.toISOString(),timeMax:end.toISOString(),singleEvents:true,orderBy:'startTime',maxResults:1,fields:'kind'},{timeout:20000,retry:false});
 if(b.status!==200||b.data.kind!=='calendar#events')throw new Error('Events failed');
 console.log(JSON.stringify({result:'PASS',freebusy:'PASS',events:'PASS',contents_returned:false}));
}
main().catch(e=>{const code=e?.response?.data?.error;const classification=['invalid_grant','invalid_client','access_denied'].includes(code)?code:'unspecified_failure';console.log(JSON.stringify({result:'FAIL',classification}));process.exitCode=1;});
