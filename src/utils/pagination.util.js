import { ApiError } from './index.js';

export const paginate = async (model, query = {}, options = {}) => {
  const {
    page = 1,
    limit = 20,
    sort = 'createdAt',
    order = 'desc',
    select = null,
    populate = []
  } = options;

  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const skip = (pageNum - 1) * limitNum;
  const sortOptions = { [sort]: order === 'asc' ? 1 : -1 };

  try {
    let queryBuilder = model.find(query);
    
    if (select) queryBuilder = queryBuilder.select(select);
    if (populate.length) populate.forEach(pop => queryBuilder = queryBuilder.populate(pop));

    const [data, total] = await Promise.all([
      queryBuilder.sort(sortOptions).skip(skip).limit(limitNum).lean(),
      model.countDocuments(query)
    ]);

    const totalPages = Math.ceil(total / limitNum);

    return {
      data,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: totalPages,
        hasNext: pageNum < totalPages,
        hasPrev: pageNum > 1
      }
    };
  } catch (error) {
    throw new ApiError(500, 'Pagination failed', error);
  }
};

export default paginate;