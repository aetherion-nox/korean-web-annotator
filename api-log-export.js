// Browser-independent presentation helpers. No additional keys or prompt text
// are invented; request/response downloads are the JSON actually exchanged.
export function exportApiRequestBody(record){
 if(!record||!record.body||typeof record.body!=='object')throw Error('No API request body');
 return record.body;
}
export function exportApiResponseJson(record){
 if(!record?.response?.parsed||typeof record.response.parsed!=='object')throw Error('No complete JSON reply');
 return record.response.parsed;
}
export function exportApiExchangeDiagnostic(record){
 if(!record||typeof record!=='object')throw Error('No API exchange');
 return {format:'kra-model-api-diagnostic-v2',...record};
}
