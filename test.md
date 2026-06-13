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
curl -s "$BASE_URL/health" -s | jq
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
  -s | jq
```

## 3. 登录并保存 Token

```bash
LOGIN_JSON=$(curl -s -X POST "$BASE_URL/api/auth/login" \
  -H "content-type: application/json" \
  -d "{\"username\":\"admin\",\"password\":\"$PASSWORD_HASH\"}")

echo "$LOGIN_JSON" -s | jq

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
  -s | jq
```

## 5. 创建用户

创建经理：

```bash
export MANAGER_USERNAME="manager_${RUN_ID}"

curl -s -X POST "$BASE_URL/api/users" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -H "content-type: application/json" \
  -d "{\"username\":\"$MANAGER_USERNAME\",\"password\":\"$PASSWORD_HASH\",\"realName\":\"测试经理\",\"phone\":\"13910010001\",\"role\":2,\"remark\":\"curl 测试经理\"}" \
  -s | jq
```

创建普通员工：

```bash
export SALES_USERNAME="sales_${RUN_ID}"

curl -s -X POST "$BASE_URL/api/users" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -H "content-type: application/json" \
  -d "{\"username\":\"$SALES_USERNAME\",\"password\":\"$PASSWORD_HASH\",\"realName\":\"测试销售\",\"phone\":\"13930030001\",\"role\":3,\"remark\":\"curl 测试销售\"}" \
  -s | jq
```

查询用户并保存用户 ID：

```bash
USERS_JSON=$(curl -s "$BASE_URL/api/users?page=0&pagesize=50&sort=-id" \
  -H "authorization: Bearer $ACCESS_TOKEN")

echo "$USERS_JSON" -s | jq

MANAGER_ID=$(echo "$USERS_JSON" | python3 -c "import sys,json,os; data=json.load(sys.stdin); username=os.environ['MANAGER_USERNAME']; print(next(item['id'] for item in data['list'] if item['username']==username))")
SALES_ID=$(echo "$USERS_JSON" | python3 -c "import sys,json,os; data=json.load(sys.stdin); username=os.environ['SALES_USERNAME']; print(next(item['id'] for item in data['list'] if item['username']==username))")

echo "MANAGER_ID=$MANAGER_ID"
echo "SALES_ID=$SALES_ID"
```

按条件查询用户：

```bash
curl -s "$BASE_URL/api/users?username-like=$SALES_USERNAME&page=0&pagesize=10" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -s | jq
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

echo "$BATCH_JSON" -s | jq

BATCH_ID=$(echo "$BATCH_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['batchId'])")
echo "BATCH_ID=$BATCH_ID"
```

## 7. 查询批次列表与批次质量分析

批次列表：

```bash
curl -s "$BASE_URL/api/batches?page=0&pagesize=10&sort=-id&name-like=$RUN_ID&source-like=curl-test" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -s | jq
```

批次列表非法排序字段，预期 `400`：

```bash
curl -i -s "$BASE_URL/api/batches?sort=-passwordHash" \
  -H "authorization: Bearer $ACCESS_TOKEN"
```

批次质量分析：

```bash
curl -s "$BASE_URL/api/batches/$BATCH_ID/summary" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -s | jq
```

普通员工访问批次接口，预期 `403`。如果此时还没有 `SALES_ACCESS_TOKEN`，可以先跳过，执行员工登录步骤后再回头验证：

```bash
curl -i -s "$BASE_URL/api/batches?page=0&pagesize=10" \
  -H "authorization: Bearer $SALES_ACCESS_TOKEN"
```

## 8. 查询客户列表

```bash
CUSTOMERS_JSON=$(curl -s "$BASE_URL/api/customers?batchId=$BATCH_ID&page=0&pagesize=20&sort=-id" \
  -H "authorization: Bearer $ACCESS_TOKEN")

echo "$CUSTOMERS_JSON" -s | jq

CUSTOMER_ID=$(echo "$CUSTOMERS_JSON" | python3 -c "import sys,json; data=json.load(sys.stdin); print(data['list'][0]['id'])")
SECOND_CUSTOMER_ID=$(echo "$CUSTOMERS_JSON" | python3 -c "import sys,json; data=json.load(sys.stdin); print(data['list'][1]['id'] if len(data['list']) > 1 else data['list'][0]['id'])")
echo "CUSTOMER_ID=$CUSTOMER_ID"
echo "SECOND_CUSTOMER_ID=$SECOND_CUSTOMER_ID"
```

查询未分配客户：

```bash
curl -s "$BASE_URL/api/customers?is_assigned=0&page=0&pagesize=20&sort=-id" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -s | jq
```

手机号模糊查询：

```bash
curl -s "$BASE_URL/api/customers?phone-like=$PHONE_SUFFIX&page=0&pagesize=20" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -s | jq
```

## 9. 客户详情、编辑、批量更新与作废

客户详情：

```bash
curl -s "$BASE_URL/api/customers/$CUSTOMER_ID" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -s | jq
```

编辑客户资料：

```bash
curl -s -X PATCH "$BASE_URL/api/customers/$CUSTOMER_ID" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -H "content-type: application/json" \
  -d "{\"name\":\"curl 客户A\",\"company\":\"curl 公司A\",\"type\":1,\"status\":0,\"remark\":\"curl 单条修正\"}" \
  -s | jq
```

未知字段校验，预期 `400`：

```bash
curl -i -s -X PATCH "$BASE_URL/api/customers/$CUSTOMER_ID" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -H "content-type: application/json" \
  -d "{\"phone\":\"13900000000\"}"
```

批量更新客户状态、类型、备注：

```bash
curl -s -X POST "$BASE_URL/api/customers/batch-update" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -H "content-type: application/json" \
  -d "{\"customerIds\":[$CUSTOMER_ID],\"patch\":{\"type\":1,\"status\":0,\"remark\":\"curl 批量标记\"}}" \
  -s | jq
```

普通员工访问客户维护接口，预期 `403`。如果此时还没有 `SALES_ACCESS_TOKEN`，可以先跳过，执行员工登录步骤后再回头验证：

```bash
curl -i -s "$BASE_URL/api/customers/$CUSTOMER_ID" \
  -H "authorization: Bearer $SALES_ACCESS_TOKEN"

curl -i -s -X POST "$BASE_URL/api/customers/batch-update" \
  -H "authorization: Bearer $SALES_ACCESS_TOKEN" \
  -H "content-type: application/json" \
  -d "{\"customerIds\":[$CUSTOMER_ID],\"patch\":{\"status\":1}}"
```

作废第二个客户，避免影响后续通话上报测试：

```bash
curl -s -X DELETE "$BASE_URL/api/customers/$SECOND_CUSTOMER_ID" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -H "content-type: application/json" \
  -d "{\"reason\":\"curl 测试作废\"}" \
  -s | jq
```

作废后详情返回 `404`：

```bash
curl -i -s "$BASE_URL/api/customers/$SECOND_CUSTOMER_ID" \
  -H "authorization: Bearer $ACCESS_TOKEN"
```

作废后列表默认查不到：

```bash
curl -s "$BASE_URL/api/customers?id=$SECOND_CUSTOMER_ID&page=0&pagesize=10" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -s | jq
```

作废后不能分配，预期 `400`：

```bash
curl -i -s -X POST "$BASE_URL/api/customers/assign" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -H "content-type: application/json" \
  -d "{\"customerIds\":[$SECOND_CUSTOMER_ID],\"targetUserId\":$SALES_ID,\"reason\":\"作废后分配测试\"}"
```

## 10. 分配客户给员工

```bash
curl -s -X POST "$BASE_URL/api/customers/assign" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -H "content-type: application/json" \
  -d "{\"customerIds\":[$CUSTOMER_ID],\"targetUserId\":$SALES_ID,\"reason\":\"curl 测试分配\"}" \
  -s | jq
```

查询已分配客户：

```bash
curl -s "$BASE_URL/api/customers?is_assigned=1&page=0&pagesize=20&sort=-id" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -s | jq
```

回收到公海：

```bash
curl -s -X POST "$BASE_URL/api/customers/assign" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -H "content-type: application/json" \
  -d "{\"customerIds\":[$CUSTOMER_ID],\"targetUserId\":null,\"reason\":\"curl 测试回收公海\"}" \
  -s | jq
```

再次分配给员工，供通话上报测试使用：

```bash
curl -s -X POST "$BASE_URL/api/customers/assign" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -H "content-type: application/json" \
  -d "{\"customerIds\":[$CUSTOMER_ID],\"targetUserId\":$SALES_ID,\"reason\":\"curl 测试重新分配\"}" \
  -s | jq
```

## 11. 员工登录并查询我的客户

```bash
SALES_LOGIN_JSON=$(curl -s -X POST "$BASE_URL/api/auth/login" \
  -H "content-type: application/json" \
  -d "{\"username\":\"$SALES_USERNAME\",\"password\":\"$PASSWORD_HASH\"}")

echo "$SALES_LOGIN_JSON" -s | jq

SALES_ACCESS_TOKEN=$(echo "$SALES_LOGIN_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")
SALES_REFRESH_TOKEN=$(echo "$SALES_LOGIN_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['refreshToken'])")
```

```bash
curl -s "$BASE_URL/api/my-customers?page=0&pagesize=20&sort=-id" \
  -H "authorization: Bearer $SALES_ACCESS_TOKEN" \
  -s | jq
```

历史客户接口此时默认查不到当前未拨打客户：

```bash
curl -s "$BASE_URL/api/my-customers/history?page=0&pagesize=20&sort=-updatedAt" \
  -H "authorization: Bearer $SALES_ACCESS_TOKEN" \
  -s | jq
```

作废客户不能通话上报，预期 `404`：

```bash
curl -i -s -X POST "$BASE_URL/api/calls/report" \
  -H "authorization: Bearer $SALES_ACCESS_TOKEN" \
  -H "content-type: application/json" \
  -d "{\"customerId\":$SECOND_CUSTOMER_ID,\"duration\":30,\"callResult\":1,\"callRemark\":\"作废后上报测试\"}"
```

## 12. 上报通话结果

```bash
curl -s -X POST "$BASE_URL/api/calls/report" \
  -H "authorization: Bearer $SALES_ACCESS_TOKEN" \
  -H "content-type: application/json" \
  -d "{\"customerId\":$CUSTOMER_ID,\"duration\":66,\"callResult\":1,\"callRemark\":\"curl 测试：客户已接听\"}" \
  -s | jq
```

带 `clientRequestId`、`startedAt`、`endedAt` 的新通话上报请求：

```bash
CALL_REQUEST_ID="curl-call-$RUN_ID"
CALL_STARTED_AT="$(TZ=UTC date -u +"%Y-%m-%dT%H:%M:00.000Z")"
CALL_ENDED_AT="$(TZ=UTC date -u -v+1M +"%Y-%m-%dT%H:%M:00.000Z" 2>/dev/null || TZ=UTC date -u +"%Y-%m-%dT%H:%M:30.000Z")"

curl -s -X POST "$BASE_URL/api/calls/report" \
  -H "authorization: Bearer $SALES_ACCESS_TOKEN" \
  -H "content-type: application/json" \
  -d "{\"customerId\":$CUSTOMER_ID,\"duration\":30,\"callResult\":1,\"callRemark\":\"curl 测试：幂等真实时间\",\"clientRequestId\":\"$CALL_REQUEST_ID\",\"startedAt\":\"$CALL_STARTED_AT\",\"endedAt\":\"$CALL_ENDED_AT\"}" \
  -s | jq
```

重复提交相同 `clientRequestId`，预期返回 `idempotent=true`，且不会重复累加日报：

```bash
curl -s -X POST "$BASE_URL/api/calls/report" \
  -H "authorization: Bearer $SALES_ACCESS_TOKEN" \
  -H "content-type: application/json" \
  -d "{\"customerId\":$CUSTOMER_ID,\"duration\":30,\"callResult\":1,\"callRemark\":\"curl 测试：重复幂等请求\",\"clientRequestId\":\"$CALL_REQUEST_ID\",\"startedAt\":\"$CALL_STARTED_AT\",\"endedAt\":\"$CALL_ENDED_AT\"}" \
  -s | jq
```

非法时间校验，预期 `400`：

```bash
curl -i -s -X POST "$BASE_URL/api/calls/report" \
  -H "authorization: Bearer $SALES_ACCESS_TOKEN" \
  -H "content-type: application/json" \
  -d "{\"customerId\":$CUSTOMER_ID,\"duration\":30,\"callResult\":1,\"callRemark\":\"curl 测试：时间倒挂\",\"startedAt\":\"2026-06-13T01:16:36.000Z\",\"endedAt\":\"2026-06-13T01:15:30.000Z\"}"
```

查询今日战报：

```bash
curl -s "$BASE_URL/api/my-summary" \
  -H "authorization: Bearer $SALES_ACCESS_TOKEN" \
  -s | jq
```

查询我的历史客户：

```bash
curl -s "$BASE_URL/api/my-customers/history?page=0&pagesize=10&sort=-updatedAt&status=1&type=1" \
  -H "authorization: Bearer $SALES_ACCESS_TOKEN" \
  -s | jq
```

按名称、手机号、公司模糊查询我的历史客户：

```bash
curl -s "$BASE_URL/api/my-customers/history?page=0&pagesize=10&name-like=curl&phone-like=$PHONE_SUFFIX&company-like=curl" \
  -H "authorization: Bearer $SALES_ACCESS_TOKEN" \
  -s | jq
```

传入 ownerId 查询别人客户，预期 `400`：

```bash
curl -i -s "$BASE_URL/api/my-customers/history?ownerId=$MANAGER_ID" \
  -H "authorization: Bearer $SALES_ACCESS_TOKEN"
```

超级管理员访问我的历史客户，预期 `403`：

```bash
curl -i -s "$BASE_URL/api/my-customers/history?page=0&pagesize=10" \
  -H "authorization: Bearer $ACCESS_TOKEN"
```

## 13. 审计与明细查询

分配审计日志：

```bash
curl -s "$BASE_URL/api/assignment-logs?page=0&pagesize=20&sort=-id&customerId=$CUSTOMER_ID" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -s | jq
```

按 action 查询分配日志：

```bash
curl -s "$BASE_URL/api/assignment-logs?page=0&pagesize=20&action=assign" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -s | jq
```

通话记录查询：

```bash
curl -s "$BASE_URL/api/call-logs?page=0&pagesize=20&sort=-id&customerId=$CUSTOMER_ID&callResult=1" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -s | jq
```

时间范围查询通话记录：

```bash
TODAY=$(TZ=Asia/Shanghai date +%F)

curl -s "$BASE_URL/api/call-logs?page=0&pagesize=20&startDate=$TODAY&endDate=$TODAY" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -s | jq
```

普通员工访问审计/明细接口，预期 `403`：

```bash
curl -i -s "$BASE_URL/api/assignment-logs?page=0&pagesize=10" \
  -H "authorization: Bearer $SALES_ACCESS_TOKEN"

curl -i -s "$BASE_URL/api/call-logs?page=0&pagesize=10" \
  -H "authorization: Bearer $SALES_ACCESS_TOKEN"
```

非法排序字段校验，预期 `400`：

```bash
curl -i -s "$BASE_URL/api/call-logs?sort=-passwordHash" \
  -H "authorization: Bearer $ACCESS_TOKEN"
```

## 14. Dashboard 管理端统计

管理端首页核心指标。`DASHBOARD_DATE` 可改成任意 `YYYY-MM-DD` 日期；默认使用今天的北京时间日期：

```bash
DASHBOARD_DATE=$(TZ=Asia/Shanghai date +%F)

curl -s "$BASE_URL/api/dashboard/overview?date=$DASHBOARD_DATE" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -s | jq
```

员工日报排行榜：

```bash
curl -s "$BASE_URL/api/dashboard/agent-daily?date=$DASHBOARD_DATE&page=0&pagesize=20&sort=-totalCalls" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -s | jq
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

## 15. 修改密码接口

下面只是验证参数和鉴权链路。执行后员工密码会被改成 `password` 对应的同一个 hash，行为等价于不变。

```bash
curl -s -X POST "$BASE_URL/api/auth/change-password" \
  -H "authorization: Bearer $SALES_ACCESS_TOKEN" \
  -H "content-type: application/json" \
  -d "{\"oldPassword\":\"$PASSWORD_HASH\",\"newPassword\":\"$PASSWORD_HASH\"}" \
  -s | jq
```

## 16. 权限与安全校验

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

## 17. 禁用用户与 Token 校验

禁用刚创建的员工：

```bash
curl -s -X DELETE "$BASE_URL/api/users/$SALES_ID" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -s | jq
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
  -s | jq
```

恢复后可以重新登录，预期 `200`：

```bash
curl -s -X POST "$BASE_URL/api/auth/login" \
  -H "content-type: application/json" \
  -d "{\"username\":\"$SALES_USERNAME\",\"password\":\"$PASSWORD_HASH\"}" \
  -s | jq
```

恢复后，刚才被删除的旧 RefreshToken 仍不能使用，预期 `403`：

```bash
curl -i -s -X POST "$BASE_URL/api/auth/refresh" \
  -H "content-type: application/json" \
  -d "{\"refreshToken\":\"$SALES_REFRESH_TOKEN\"}"
```

## 18. 退出登录

管理员退出登录：

```bash
curl -s -X POST "$BASE_URL/api/auth/logout" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -H "content-type: application/json" \
  -d "{\"refreshToken\":\"$REFRESH_TOKEN\"}" \
  -s | jq
```

退出后 refresh token 不能再使用，预期 `403`：

```bash
curl -i -s -X POST "$BASE_URL/api/auth/refresh" \
  -H "content-type: application/json" \
  -d "{\"refreshToken\":\"$REFRESH_TOKEN\"}"
```
