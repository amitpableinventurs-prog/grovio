import { Result, Button } from 'antd';
import { useNavigate } from 'react-router-dom';

export default function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <Result
      status="404"
      title="404"
      subTitle="Yeh page maujood nahi hai."
      extra={
        <Button type="primary" onClick={() => navigate('/dashboard')}>
          Dashboard par jayein
        </Button>
      }
    />
  );
}
