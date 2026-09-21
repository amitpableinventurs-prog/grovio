const { ContentPage } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const { logAdminActivity } = require('../../services/audit.service');

const VALID_SLUGS = ['about-us', 'privacy-policy', 'terms-and-conditions'];

// GET /admin/content-pages
const listContentPages = catchAsync(async (req, res) => {
  const pages = await ContentPage.find().sort({ slug: 1 });
  new ApiResponse(200, pages).send(res);
});

// GET /admin/content-pages/:slug
const getContentPage = catchAsync(async (req, res) => {
  const page = await ContentPage.findOne({ slug: req.params.slug });
  if (!page) throw new ApiError(404, 'Page not found');
  new ApiResponse(200, page).send(res);
});

// PUT /admin/content-pages/:slug  { title, content }
const updateContentPage = catchAsync(async (req, res) => {
  if (!VALID_SLUGS.includes(req.params.slug)) throw new ApiError(400, `slug must be one of: ${VALID_SLUGS.join(', ')}`);

  const { title, content } = req.body;
  if (!title || !content) throw new ApiError(400, 'title and content are required');

  const page = await ContentPage.findOneAndUpdate(
    { slug: req.params.slug },
    { title, content },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  await logAdminActivity({
    adminId: req.user.id,
    action: 'content_page.update',
    entityType: 'ContentPage',
    entityId: page._id,
    metadata: { slug: page.slug },
  });

  new ApiResponse(200, page, 'Page updated').send(res);
});

module.exports = { listContentPages, getContentPage, updateContentPage };
