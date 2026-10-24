/**
 * 可安全返回给客户端的业务错误。其他错误（尤其是 fs 错误，message 中带有服务器绝对路径）
 * 只记录日志，对外统一返回脱敏后的提示。
 */
class ClientError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'ClientError';
    this.status = status;
  }
}

class PathError extends ClientError {
  constructor(message = '非法路径') {
    super(message, 403);
    this.name = 'PathError';
  }
}

const FS_ERRORS = {
  ENOENT: [404, '文件或目录不存在'],
  EEXIST: [409, '目标已存在'],
  ENOTEMPTY: [409, '目录非空'],
  EISDIR: [400, '目标是目录'],
  ENOTDIR: [400, '路径不是目录'],
  EACCES: [403, '没有访问权限'],
  EPERM: [403, '没有访问权限'],
  EBUSY: [409, '文件被占用'],
  EINVAL: [400, '无效的操作'],
  ENAMETOOLONG: [400, '文件名过长']
};

/** 把任意错误转换为 { status, message }，不泄露内部细节 */
function toClientError(err) {
  if (err instanceof ClientError) return { status: err.status, message: err.message };
  if (err && FS_ERRORS[err.code]) {
    const [status, message] = FS_ERRORS[err.code];
    return { status, message };
  }
  return { status: 500, message: '服务器内部错误' };
}

module.exports = { ClientError, PathError, toClientError };
