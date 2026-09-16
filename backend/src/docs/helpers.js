// Small builders to keep openapi.js declarative instead of repeating boilerplate
// for every one of ~150 endpoints.

function envelope(dataSchema, description = 'Success') {
  return {
    description,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string', example: description },
            data: dataSchema,
          },
        },
      },
    },
  };
}

function paginated(itemSchema) {
  return {
    type: 'object',
    properties: {
      items: { type: 'array', items: itemSchema },
      meta: { $ref: '#/components/schemas/PageMeta' },
    },
  };
}

function ref(name) {
  return { $ref: `#/components/schemas/${name}` };
}

function errorResponse(description) {
  return {
    description,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string', example: description },
            errors: { type: 'array', items: { type: 'object' } },
          },
        },
      },
    },
  };
}

const RESPONSES_401 = errorResponse('Missing/invalid/expired access token');
const RESPONSES_403 = errorResponse('Forbidden — wrong role or missing admin permission');
const RESPONSES_404 = errorResponse('Not found');
const RESPONSES_422 = errorResponse('Validation failed');

function jsonBody(properties, required = []) {
  return {
    required: true,
    content: { 'application/json': { schema: { type: 'object', properties, required } } },
  };
}

function formBody(properties, required = []) {
  return {
    required: true,
    content: { 'multipart/form-data': { schema: { type: 'object', properties, required } } },
  };
}

function idParam(name = 'id', description = 'Resource ID (Mongo ObjectId)') {
  return { name, in: 'path', required: true, schema: { type: 'string', example: '66f1a2b3c4d5e6f789012345' }, description };
}

function q(name, description, schema = { type: 'string' }) {
  return { name, in: 'query', required: false, description, schema };
}

const PAGE_QS = [
  q('page', 'Page number (default 1)', { type: 'integer', default: 1 }),
  q('limit', 'Page size (default 20, max 100)', { type: 'integer', default: 20 }),
];

function bearer(...scopes) {
  return { security: [{ bearerAuth: [] }] };
}

module.exports = {
  envelope,
  paginated,
  ref,
  errorResponse,
  RESPONSES_401,
  RESPONSES_403,
  RESPONSES_404,
  RESPONSES_422,
  jsonBody,
  formBody,
  idParam,
  q,
  PAGE_QS,
  bearer,
};
