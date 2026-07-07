/** async 컨트롤러의 예외를 express 에러 미들웨어로 전달 */
module.exports = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
