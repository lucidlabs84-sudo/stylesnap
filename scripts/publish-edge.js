import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function publish() {
  const productId = process.env.EDGE_PRODUCT_ID;
  const clientId = process.env.EDGE_CLIENT_ID;
  const apiKey = process.env.EDGE_CLIENT_SECRET; // v1.1 uses the secret as ApiKey
  
  if (!productId || !clientId || !apiKey) {
    console.error('Missing EDGE_PRODUCT_ID, EDGE_CLIENT_ID or EDGE_CLIENT_SECRET (ApiKey)');
    process.exit(1);
  }

  // 获取包路径
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
  const zipPath = path.join(__dirname, `../releases/edge/stylesnap-edge-v${packageJson.version}/stylesnap-v${packageJson.version}.zip`);
  
  if (!fs.existsSync(zipPath)) {
    console.error('Zip file not found:', zipPath);
    process.exit(1);
  }

  // 1. 上传 ZIP 文件
  console.log(`Uploading ${zipPath}...`);
  const uploadUrl = `https://api.addons.microsoftedge.microsoft.com/v1/products/${productId}/submissions/draft/package`;
  
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': `ApiKey ${apiKey}`,
      'X-ClientID': clientId,
      'Content-Type': 'application/zip'
    },
    body: fs.readFileSync(zipPath)
  });

  if (!uploadRes.ok && uploadRes.status !== 202) {
    const errorText = await uploadRes.text();
    console.error('Failed to upload package:', uploadRes.status, errorText);
    process.exit(1);
  }
  
  const operationId = uploadRes.headers.get('Location');
  console.log('Upload initiated. Operation Location:', operationId);

  // Poll upload status
  if (operationId) {
    console.log('Checking upload status...');
    let uploadSuccess = false;
    for(let i=0; i<15; i++) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        const statusRes = await fetch(`https://api.addons.microsoftedge.microsoft.com/v1/products/${productId}/submissions/draft/package/operations/${operationId}`, {
           headers: { 
             'Authorization': `ApiKey ${apiKey}`,
             'X-ClientID': clientId
           }
        });
        if(statusRes.ok) {
           const statusData = await statusRes.json();
           console.log(`Upload status: ${statusData.status}`);
           if (statusData.status === 'Succeeded') {
               uploadSuccess = true;
               break;
           } else if (statusData.status === 'Failed') {
               console.error('Upload failed:', statusData.message || statusData.errorCode);
               process.exit(1);
           }
        }
    }
  }

  // 2. 提交发布审核
  console.log('Submitting for review...');
  const publishUrl = `https://api.addons.microsoftedge.microsoft.com/v1/products/${productId}/submissions`;
  const publishRes = await fetch(publishUrl, {
    method: 'POST',
    headers: {
      'Authorization': `ApiKey ${apiKey}`,
      'X-ClientID': clientId,
      'Content-Length': '0'
    }
  });

  if (!publishRes.ok && publishRes.status !== 202) {
    const errorText = await publishRes.text();
    console.error('Failed to publish:', publishRes.status, errorText);
    process.exit(1);
  }

  const publishOperationId = publishRes.headers.get('Location');
  console.log('Publish initiated. Operation Location:', publishOperationId);

  // Poll publish status
  if (publishOperationId) {
    console.log('Checking publish status...');
    for(let i=0; i<15; i++) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        const statusRes = await fetch(`https://api.addons.microsoftedge.microsoft.com/v1/products/${productId}/submissions/operations/${publishOperationId}`, {
           headers: { 
             'Authorization': `ApiKey ${apiKey}`,
             'X-ClientID': clientId
           }
        });
        if(statusRes.ok) {
           const statusData = await statusRes.json();
           console.log(`Publish status: ${statusData.status}`);
           if (statusData.status === 'Succeeded') {
               console.log('Successfully submitted to Edge Add-ons store! Submission ID:', statusData.message);
               break;
           } else if (statusData.status === 'Failed') {
               console.error('Publish failed:', statusData.message || statusData.errorCode);
               process.exit(1);
           }
        }
    }
  }
}

publish().catch(console.error);