const { badRequest } = require('../utils/errors');
const { ApiError } = require('../utils/errors');
const authService = require('../services/authService');

exports.register = async (req, res) => {
  const { username, password, nickname } = req.body || {};
  res.status(201).json(await authService.register(username, password, nickname));
};

exports.login = async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) throw badRequest('username, password가 필요합니다');
  res.json(await authService.login(username, password));
};

exports.logout = async (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  await authService.logout(token);
  res.status(204).end();
};

exports.me = async (req, res) => {
  if (!req.user) throw new ApiError(401, '로그인이 필요합니다');
  res.json(await authService.getProfile(req.user.id));
};
