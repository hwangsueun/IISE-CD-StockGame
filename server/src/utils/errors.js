/** API 오류. statusCode와 사용자 메시지를 함께 전달한다. */
class ApiError extends Error {
  constructor(statusCode, message, detail) {
    super(message);
    this.statusCode = statusCode;
    this.detail = detail;
  }
}

const badRequest = (msg, detail) => new ApiError(400, msg, detail);
const notFound = (msg = '리소스를 찾을 수 없습니다') => new ApiError(404, msg);
const conflict = (msg, detail) => new ApiError(409, msg, detail);

module.exports = { ApiError, badRequest, notFound, conflict };
