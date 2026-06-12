# 测试数据脚本

# 1. 登录获取 Token（密码为 "password" 的 SHA-256）
TOKEN=$(curl -s -X POST http://localhost:8787/api/auth/login \
  -H "content-type: application/json" \
  -d '{"username":"admin","password":"240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")

echo "Token: $TOKEN"

# 2. 创建经理（role=2）
curl -s -X POST http://localhost:8787/api/users \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"username":"manager01","password":"240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9","realName":"王经理","phone":"13900010001","role":2,"remark":"华东区经理"}'

curl -s -X POST http://localhost:8787/api/users \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"username":"manager02","password":"240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9","realName":"李经理","phone":"13900010002","role":2,"remark":"华南区经理"}'

# 3. 创建普通员工（role=3）
curl -s -X POST http://localhost:8787/api/users \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"username":"sales01","password":"240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9","realName":"张销售","phone":"13900030001","role":3,"remark":"华东一组"}'

curl -s -X POST http://localhost:8787/api/users \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"username":"sales02","password":"240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9","realName":"刘销售","phone":"13900030002","role":3,"remark":"华东二组"}'

curl -s -X POST http://localhost:8787/api/users \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"username":"sales03","password":"240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9","realName":"陈销售","phone":"13900030003","role":3,"remark":"华南一组"}'

curl -s -X POST http://localhost:8787/api/users \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"username":"sales04","password":"240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9","realName":"赵销售","phone":"13900030004","role":3,"remark":"华南二组"}'

curl -s -X POST http://localhost:8787/api/users \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"username":"sales05","password":"240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9","realName":"孙销售","phone":"13900030005","role":3,"remark":"华东一组"}'

# 4. 验证：查询员工列表
curl -s "http://localhost:8787/api/users?page=0&pagesize=20&sort=-id" \
  -H "authorization: Bearer $TOKEN" | python3 -m json.tool
