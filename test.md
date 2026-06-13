# Telemark 后端本地接口 curl 测试

本文档用于本地启动后，快速验证当前已经实现的接口是否正常。

默认本地地址：

```bash
BASE_URL=http://localhost:8787
PASSWORD_HASH=240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9
RUN_ID=$(date +%s)
PHONE_SUFFIX=$(printf "%08d" $((RUN_ID % 100000000)))
```

`PASSWORD_HASH` 对应明文密码 `password` 的 `SHA-256`。

## 0. 本地启动

先应用本地 D1 migration：

```bash
pnpm db:migrations:apply:local
```

启动 Worker：

```bash
pnpm dev
```

另开一个终端执行下面的 curl。

## 1. 健康检查

```bash
curl -s "$BASE_URL/health" | python3 -m json.tool
```

预期：

```json
{
  "ok": true,
  "database": true
}
```

## 2. 初始化管理员

如果本地库已经有用户，这一步会返回 `409`，可以跳过，直接登录。

```bash
curl -s -X POST "$BASE_URL/api/auth/init-admin" \
  -H "content-type: application/json" \
  -d "{\"username\":\"admin\",\"password\":\"$PASSWORD_HASH\",\"realName\":\"超级管理员\",\"phone\":\"13800000000\",\"remark\":\"本地初始化管理员\"}" \
  | python3 -m json.tool
```

## 3. 登录并保存 Token

```bash
LOGIN_JSON=$(curl -s -X POST "$BASE_URL/api/auth/login" \
  -H "content-type: application/json" \
  -d "{\"username\":\"admin\",\"password\":\"$PASSWORD_HASH\"}")

echo "$LOGIN_JSON" | python3 -m json.tool

ACCESS_TOKEN=$(echo "$LOGIN_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")
REFRESH_TOKEN=$(echo "$LOGIN_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['refreshToken'])")

echo "ACCESS_TOKEN=$ACCESS_TOKEN"
echo "REFRESH_TOKEN=$REFRESH_TOKEN"
```

## 4. Refresh Token 换新 AccessToken

```bash
curl -s -X POST "$BASE_URL/api/auth/refresh" \
  -H "content-type: application/json" \
  -d "{\"refreshToken\":\"$REFRESH_TOKEN\"}" \
  | python3 -m json.tool
```

## 5. 创建用户

创建经理：

```bash
export MANAGER_USERNAME="manager_${RUN_ID}"

curl -s -X POST "$BASE_URL/api/users" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -H "content-type: application/json" \
  -d "{\"username\":\"$MANAGER_USERNAME\",\"password\":\"$PASSWORD_HASH\",\"realName\":\"测试经理\",\"phone\":\"13910010001\",\"role\":2,\"remark\":\"curl 测试经理\"}" \
  | python3 -m json.tool
```

创建普通员工：

```bash
export SALES_USERNAME="sales_${RUN_ID}"

curl -s -X POST "$BASE_URL/api/users" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -H "content-type: application/json" \
  -d "{\"username\":\"$SALES_USERNAME\",\"password\":\"$PASSWORD_HASH\",\"realName\":\"测试销售\",\"phone\":\"13930030001\",\"role\":3,\"remark\":\"curl 测试销售\"}" \
  | python3 -m json.tool
```

查询用户并保存用户 ID：

```bash
USERS_JSON=$(curl -s "$BASE_URL/api/users?page=0&pagesize=50&sort=-id" \
  -H "authorization: Bearer $ACCESS_TOKEN")

echo "$USERS_JSON" | python3 -m json.tool

MANAGER_ID=$(echo "$USERS_JSON" | python3 -c "import sys,json,os; data=json.load(sys.stdin); username=os.environ['MANAGER_USERNAME']; print(next(item['id'] for item in data['list'] if item['username']==username))")
SALES_ID=$(echo "$USERS_JSON" | python3 -c "import sys,json,os; data=json.load(sys.stdin); username=os.environ['SALES_USERNAME']; print(next(item['id'] for item in data['list'] if item['username']==username))")

echo "MANAGER_ID=$MANAGER_ID"
echo "SALES_ID=$SALES_ID"
```

按条件查询用户：

```bash
curl -s "$BASE_URL/api/users?username-like=$SALES_USERNAME&page=0&pagesize=10" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  | python3 -m json.tool
```

## 6. 导入客户批次

```bash
BATCH_JSON=$(curl -s -X POST "$BASE_URL/api/batches/import" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -H "content-type: application/json" \
  -d "{
    \"name\":\"curl 测试批次 $RUN_ID\",
    \"source\":\"curl-test\",
    \"cost\":100,
    \"customers\":[
      {\"phone\":\"139$PHONE_SUFFIX\",\"name\":\"测试客户A\",\"company\":\"测试公司A\"},
      {\"phone\":\"138$PHONE_SUFFIX\",\"name\":\"测试客户B\",\"company\":\"测试公司B\"},
      {\"phone\":\"139$PHONE_SUFFIX\",\"name\":\"重复客户\",\"company\":\"重复公司\"}
    ]
  }")

echo "$BATCH_JSON" | python3 -m json.tool

BATCH_ID=$(echo "$BATCH_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['batchId'])")
echo "BATCH_ID=$BATCH_ID"
```

## 7. 查询客户列表

```bash
CUSTOMERS_JSON=$(curl -s "$BASE_URL/api/customers?batchId=$BATCH_ID&page=0&pagesize=20&sort=-id" \
  -H "authorization: Bearer $ACCESS_TOKEN")

echo "$CUSTOMERS_JSON" | python3 -m json.tool

CUSTOMER_ID=$(echo "$CUSTOMERS_JSON" | python3 -c "import sys,json; data=json.load(sys.stdin); print(data['list'][0]['id'])")
echo "CUSTOMER_ID=$CUSTOMER_ID"
```

查询未分配客户：

```bash
curl -s "$BASE_URL/api/customers?is_assigned=0&page=0&pagesize=20&sort=-id" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  | python3 -m json.tool
```

手机号模糊查询：

```bash
curl -s "$BASE_URL/api/customers?phone-like=$PHONE_SUFFIX&page=0&pagesize=20" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  | python3 -m json.tool
```

## 8. 分配客户给员工

```bash
curl -s -X POST "$BASE_URL/api/customers/assign" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -H "content-type: application/json" \
  -d "{\"customerIds\":[$CUSTOMER_ID],\"targetUserId\":$SALES_ID,\"reason\":\"curl 测试分配\"}" \
  | python3 -m json.tool
```

查询已分配客户：

```bash
curl -s "$BASE_URL/api/customers?is_assigned=1&page=0&pagesize=20&sort=-id" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  | python3 -m json.tool
```

回收到公海：

```bash
curl -s -X POST "$BASE_URL/api/customers/assign" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -H "content-type: application/json" \
  -d "{\"customerIds\":[$CUSTOMER_ID],\"targetUserId\":null,\"reason\":\"curl 测试回收公海\"}" \
  | python3 -m json.tool
```

再次分配给员工，供通话上报测试使用：

```bash
curl -s -X POST "$BASE_URL/api/customers/assign" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -H "content-type: application/json" \
  -d "{\"customerIds\":[$CUSTOMER_ID],\"targetUserId\":$SALES_ID,\"reason\":\"curl 测试重新分配\"}" \
  | python3 -m json.tool
```

## 9. 员工登录并查询我的客户

```bash
SALES_LOGIN_JSON=$(curl -s -X POST "$BASE_URL/api/auth/login" \
  -H "content-type: application/json" \
  -d "{\"username\":\"$SALES_USERNAME\",\"password\":\"$PASSWORD_HASH\"}")

echo "$SALES_LOGIN_JSON" | python3 -m json.tool

SALES_ACCESS_TOKEN=$(echo "$SALES_LOGIN_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")
SALES_REFRESH_TOKEN=$(echo "$SALES_LOGIN_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['refreshToken'])")
```

```bash
curl -s "$BASE_URL/api/my-customers?page=0&pagesize=20&sort=-id" \
  -H "authorization: Bearer $SALES_ACCESS_TOKEN" \
  | python3 -m json.tool
```

## 10. 上报通话结果

```bash
curl -s -X POST "$BASE_URL/api/calls/report" \
  -H "authorization: Bearer $SALES_ACCESS_TOKEN" \
  -H "content-type: application/json" \
  -d "{\"customerId\":$CUSTOMER_ID,\"duration\":66,\"callResult\":1,\"callRemark\":\"curl 测试：客户已接听\"}" \
  | python3 -m json.tool
```

查询今日战报：

```bash
curl -s "$BASE_URL/api/my-summary" \
  -H "authorization: Bearer $SALES_ACCESS_TOKEN" \
  | python3 -m json.tool
```

## 11. Dashboard 管理端统计

管理端首页核心指标。`DASHBOARD_DATE` 可改成任意 `YYYY-MM-DD` 日期；默认使用今天的北京时间日期：

```bash
DASHBOARD_DATE=$(TZ=Asia/Shanghai date +%F)

curl -s "$BASE_URL/api/dashboard/overview?date=$DASHBOARD_DATE" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  | python3 -m json.tool
```

员工日报排行榜：

```bash
curl -s "$BASE_URL/api/dashboard/agent-daily?date=$DASHBOARD_DATE&page=0&pagesize=20&sort=-totalCalls" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  | python3 -m json.tool
```

非法排序字段校验，预期 `400`：

```bash
curl -i -s "$BASE_URL/api/dashboard/agent-daily?date=$DASHBOARD_DATE&sort=-passwordHash" \
  -H "authorization: Bearer $ACCESS_TOKEN"
```

普通员工访问 Dashboard，预期 `403`：

```bash
curl -i -s "$BASE_URL/api/dashboard/overview?date=$DASHBOARD_DATE" \
  -H "authorization: Bearer $SALES_ACCESS_TOKEN"
```

## 12. 修改密码接口

下面只是验证参数和鉴权链路。执行后员工密码会被改成 `password` 对应的同一个 hash，行为等价于不变。

```bash
curl -s -X POST "$BASE_URL/api/auth/change-password" \
  -H "authorization: Bearer $SALES_ACCESS_TOKEN" \
  -H "content-type: application/json" \
  -d "{\"oldPassword\":\"$PASSWORD_HASH\",\"newPassword\":\"$PASSWORD_HASH\"}" \
  | python3 -m json.tool
```

## 13. 权限与安全校验

普通员工不能访问全量客户列表，预期 `403`：

```bash
curl -i -s "$BASE_URL/api/customers?page=0&pagesize=10" \
  -H "authorization: Bearer $SALES_ACCESS_TOKEN"
```

普通员工不能访问用户列表，预期 `403`：

```bash
curl -i -s "$BASE_URL/api/users?page=0&pagesize=10" \
  -H "authorization: Bearer $SALES_ACCESS_TOKEN"
```

超级管理员不能调用通话上报接口，预期 `403`：

```bash
curl -i -s -X POST "$BASE_URL/api/calls/report" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -H "content-type: application/json" \
  -d "{\"customerId\":$CUSTOMER_ID,\"duration\":10,\"callResult\":1,\"callRemark\":\"管理员越权测试\"}"
```

## 14. 禁用用户与 Token 校验

禁用刚创建的员工：

```bash
curl -s -X DELETE "$BASE_URL/api/users/$SALES_ID" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  | python3 -m json.tool
```

禁用用户不能重新登录，预期 `401`：

```bash
curl -i -s -X POST "$BASE_URL/api/auth/login" \
  -H "content-type: application/json" \
  -d "{\"username\":\"$SALES_USERNAME\",\"password\":\"$PASSWORD_HASH\"}"
```

禁用用户旧 AccessToken 不能访问受保护接口，预期 `401`：

```bash
curl -i -s "$BASE_URL/api/my-summary" \
  -H "authorization: Bearer $SALES_ACCESS_TOKEN"
```

禁用用户旧 RefreshToken 不能刷新，预期 `403`：

```bash
curl -i -s -X POST "$BASE_URL/api/auth/refresh" \
  -H "content-type: application/json" \
  -d "{\"refreshToken\":\"$SALES_REFRESH_TOKEN\"}"
```

恢复员工状态：

```bash
curl -s -X PATCH "$BASE_URL/api/users/$SALES_ID" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -H "content-type: application/json" \
  -d "{\"status\":1}" \
  | python3 -m json.tool
```

恢复后可以重新登录，预期 `200`：

```bash
curl -s -X POST "$BASE_URL/api/auth/login" \
  -H "content-type: application/json" \
  -d "{\"username\":\"$SALES_USERNAME\",\"password\":\"$PASSWORD_HASH\"}" \
  | python3 -m json.tool
```

恢复后，刚才被删除的旧 RefreshToken 仍不能使用，预期 `403`：

```bash
curl -i -s -X POST "$BASE_URL/api/auth/refresh" \
  -H "content-type: application/json" \
  -d "{\"refreshToken\":\"$SALES_REFRESH_TOKEN\"}"
```

## 15. 退出登录

管理员退出登录：

```bash
curl -s -X POST "$BASE_URL/api/auth/logout" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -H "content-type: application/json" \
  -d "{\"refreshToken\":\"$REFRESH_TOKEN\"}" \
  | python3 -m json.tool
```

退出后 refresh token 不能再使用，预期 `403`：

```bash
curl -i -s -X POST "$BASE_URL/api/auth/refresh" \
  -H "content-type: application/json" \
  -d "{\"refreshToken\":\"$REFRESH_TOKEN\"}"
```
