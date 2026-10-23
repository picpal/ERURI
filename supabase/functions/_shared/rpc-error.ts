// RPC 실패: 메시지는 함수 이름·SQLSTATE 뿐이라 로그에 남긴다(스펙 §7). mail-read 와 _shared/budget-deps(holdDeps)가 같이 쓴다
export class RpcError extends Error { constructor(fn: string, code: string) { super(fn + " " + code); this.name = "RpcError"; } }
