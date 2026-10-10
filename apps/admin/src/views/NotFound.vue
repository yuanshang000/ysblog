<template>
  <div style="display: grid; place-items: center; min-height: 60vh; text-align: center">
    <div>
      <div style="font-size: 76px; font-weight: 800; letter-spacing: -0.05em; color: #d8d8dc; line-height: 1">404</div>
      <h2 style="font-size: 18px; font-weight: 620; margin: 16px 0 8px">页面不存在</h2>
      <p style="color: #8a8a93; font-size: 14px; margin: 0 0 20px">你访问的后台页面不存在或已被移动</p>
      <div style="display: flex; gap: 10px; justify-content: center">
        <el-button type="primary" @click="$router.push('/dashboard')">返回工作台</el-button>
        <el-button @click="$router.back()">返回上一页</el-button>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
export default { name: 'NotFound' };
</script>