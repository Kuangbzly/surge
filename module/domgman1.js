let body = $response.body;

try {
    let obj = JSON.parse(body);

    if (obj.message && obj.message.result) {
        obj.message.result.config = null;
    }

    body = JSON.stringify(obj);
} catch (e) {
    console.log("解析 JSON 出错: " + e);
}
$done({ body });