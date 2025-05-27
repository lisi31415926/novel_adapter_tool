import React, { useState, useEffect } from 'react';
import { Modal, Form, Input, Button, Upload, message } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '../../services/api';
import type { UploadFile, UploadProps } from 'antd/es/upload/interface';

// 定义组件的 props 接口
interface NovelUploaderProps {
  visible: boolean;
  onClose: () => void;
  onUploadSuccess: () => void;
}

const NovelUploader: React.FC<NovelUploaderProps> = ({ visible, onClose, onUploadSuccess }) => {
  // 使用 Ant Design 的 Form hook
  const [form] = Form.useForm();
  // 管理文件列表的状态
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  // 管理“确定”按钮的加载状态
  const [confirmLoading, setConfirmLoading] = useState(false);

  // 获取 React Query 的 client 实例，用于刷新数据
  const queryClient = useQueryClient();

  // --- React Query Mutations ---

  // 定义“创建小说”的 mutation
  const createNovelMutation = useMutation({
    mutationFn: api.createNovel,
    onSuccess: () => {
      // 成功后让“小说列表”的缓存失效，以便重新获取最新数据
      queryClient.invalidateQueries({ queryKey: ['novels'] });
    },
  });

  // 定义“上传文件”的 mutation
  const uploadFileMutation = useMutation({
    mutationFn: ({ novelId, file }: { novelId: number; file: File }) =>
      api.uploadNovelFile(novelId, file),
    // 成功和失败的具体逻辑现在统一在 handleOk 函数中处理
  });

  // 【新增】定义“删除小说”的 mutation，用于补偿操作
  const deleteNovelMutation = useMutation({
    mutationFn: api.deleteNovel,
    onSuccess: () => {
      // 这是后台静默清理，主要通过开发者消息提示
      console.log('已成功清理临时创建的小说条目。');
      // message.success('已成功清理临时创建的小说条目。'); // 可以取消注释以获得更强的用户反馈
    },
    onError: (error: Error) => {
      // 如果清理失败，这是一个严重问题，需要通知开发者
      message.error(`警告：清理临时小说条目时发生错误: ${error.message}，请手动检查数据库！`);
    },
  });

  // --- 事件处理函数 ---

  // 处理弹窗关闭
  const handleClose = () => {
    form.resetFields(); // 重置表单字段
    setFileList([]); // 清空文件列表
    setConfirmLoading(false); // 取消加载状态
    onClose(); // 调用父组件的关闭回调
  };

  // 【核心修改】处理“确定”按钮点击事件，包含完整的事务和补偿逻辑
  const handleOk = async () => {
    let createdNovelId: number | null = null; // 用于跟踪已创建的小说ID

    try {
      // 步骤 1: 校验表单字段
      const values = await form.validateFields();

      if (!fileList.length || !fileList[0].originFileObj) {
        message.error('请选择一个文件！');
        return;
      }
      
      setConfirmLoading(true); // 开始加载状态

      // 步骤 2: 调用 aync/await 执行创建小说
      message.loading({ content: '正在创建小说条目...', key: 'upload-process' });
      const newNovel = await createNovelMutation.mutateAsync(values);
      createdNovelId = newNovel.id; // 保存成功创建的小说ID

      // 步骤 3: 调用 async/await 执行文件上传
      message.loading({ content: `条目创建成功 (ID: ${createdNovelId})，正在上传文件...`, key: 'upload-process' });
      await uploadFileMutation.mutateAsync({
        novelId: createdNovelId,
        file: fileList[0].originFileObj,
      });

      // 步骤 4: 所有操作均成功
      message.success({ content: '小说上传并处理成功！', key: 'upload-process', duration: 2 });
      onUploadSuccess(); // 通知父组件上传成功
      handleClose(); // 关闭并重置弹窗

    } catch (error: any) {
      // 步骤 5: 捕获任何步骤中的错误
      message.destroy('upload-process'); // 销毁加载提示

      // 【补偿逻辑】检查是否是在文件上传阶段失败
      if (createdNovelId) {
        // 如果 createdNovelId 存在，说明第一步成功了，但第二步失败了
        message.error(`文件上传失败: ${error.message}。正在自动清理...`, 10);
        // 执行补偿操作：删除已创建的小说条目
        await deleteNovelMutation.mutateAsync(createdNovelId);
      } else {
        // 如果 createdNovelId 不存在，说明是第一步“创建小说”就失败了
        message.error(`创建小说失败: ${error.message}`, 10);
      }
    } finally {
      // 无论成功或失败，最后都结束加载状态
      setConfirmLoading(false);
    }
  };

  // 在组件挂载或弹窗显示时，重置表单和文件列表
  useEffect(() => {
    if (visible) {
      form.resetFields();
      setFileList([]);
    }
  }, [visible, form]);


  // --- 文件上传组件的配置 ---

  const props: UploadProps = {
    onRemove: (file) => {
      const index = fileList.indexOf(file);
      const newFileList = fileList.slice();
      newFileList.splice(index, 1);
      setFileList(newFileList);
    },
    beforeUpload: (file) => {
      // 只允许上传一个文件
      setFileList([file]);
      // 阻止 antd 的自动上传行为
      return false;
    },
    fileList,
    maxCount: 1,
  };


  return (
    <Modal
      title="上传新小说"
      open={visible}
      onOk={handleOk}
      onCancel={handleClose}
      confirmLoading={confirmLoading}
      footer={[
        <Button key="back" onClick={handleClose}>
          取消
        </Button>,
        <Button
          key="submit"
          type="primary"
          loading={confirmLoading}
          onClick={handleOk}
        >
          上传并开始处理
        </Button>,
      ]}
    >
      <Form form={form} layout="vertical" name="form_in_modal">
        <Form.Item
          name="title"
          label="书名"
          rules={[{ required: true, message: '请输入书名！' }]}
        >
          <Input />
        </Form.Item>
        <Form.Item
          name="author"
          label="作者"
          rules={[{ required: true, message: '请输入作者！' }]}
        >
          <Input />
        </Form.Item>
        <Form.Item name="description" label="简介">
          <Input.TextArea rows={4} />
        </Form.Item>
        <Form.Item
          label="小说文件"
          required
        >
          <Upload {...props}>
            <Button icon={<UploadOutlined />}>选择文件 (.txt, .epub, .mobi)</Button>
          </Upload>
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default NovelUploader;