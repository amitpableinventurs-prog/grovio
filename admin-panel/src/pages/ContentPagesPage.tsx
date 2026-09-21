import { useEffect, useState } from 'react';
import { Typography, Tabs, Form, Input, Button, Card, App as AntApp, Spin } from 'antd';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchContentPages, updateContentPage, type ContentPage, type ContentSlug } from '../api/contentPages';

const LABELS: Record<ContentSlug, string> = {
  'about-us': 'About Us',
  'privacy-policy': 'Privacy Policy',
  'terms-and-conditions': 'Terms & Conditions',
};

function ContentPageEditor({ page }: { page: ContentPage }) {
  const [form] = Form.useForm();
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();

  useEffect(() => {
    form.setFieldsValue({ title: page.title, content: page.content });
  }, [page, form]);

  const mutation = useMutation({
    mutationFn: (values: { title: string; content: string }) => updateContentPage(page.slug, values),
    onSuccess: () => {
      message.success('Page saved');
      queryClient.invalidateQueries({ queryKey: ['content-pages'] });
    },
    onError: (err: any) => message.error(err?.response?.data?.message || 'Could not save page'),
  });

  return (
    <Card>
      <Typography.Paragraph type="secondary">
        Content is HTML, rendered as-is on the customer site at{' '}
        <code>/{page.slug === 'terms-and-conditions' ? 'terms' : page.slug}</code>. Use tags like <code>&lt;h2&gt;</code>,{' '}
        <code>&lt;p&gt;</code>, <code>&lt;ul&gt;&lt;li&gt;</code>, and <code>&lt;a href="..."&gt;</code>.
      </Typography.Paragraph>
      <Form form={form} layout="vertical" onFinish={(values) => mutation.mutate(values)}>
        <Form.Item name="title" label="Page Title" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="content" label="Content (HTML)" rules={[{ required: true }]}>
          <Input.TextArea rows={20} style={{ fontFamily: 'monospace', fontSize: 13 }} />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={mutation.isPending}>
          Save
        </Button>
      </Form>
    </Card>
  );
}

export default function ContentPagesPage() {
  const [activeSlug, setActiveSlug] = useState<ContentSlug>('about-us');

  const { data, isLoading } = useQuery({
    queryKey: ['content-pages'],
    queryFn: fetchContentPages,
  });

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  const pagesBySlug = new Map(data?.map((p) => [p.slug, p]));

  return (
    <div>
      <Typography.Title level={3}>Content Pages</Typography.Title>
      <Tabs
        activeKey={activeSlug}
        onChange={(key) => setActiveSlug(key as ContentSlug)}
        items={(Object.keys(LABELS) as ContentSlug[]).map((slug) => ({
          key: slug,
          label: LABELS[slug],
          children: pagesBySlug.get(slug) ? <ContentPageEditor page={pagesBySlug.get(slug)!} /> : null,
        }))}
      />
    </div>
  );
}
